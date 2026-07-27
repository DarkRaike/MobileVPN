# Backup and restore runbook

## Цели и границы

- RPO: не более 60 минут.
- RTO: не более 4 часов.
- Периодичность: каждый час.
- Offsite: другой provider, account и region.
- Шифрование: restic; password file хранится вне VPS и репозитория.
- Object Lock: governance mode минимум 7 дней, если storage поддерживает.
- Restore поверх live volume запрещён программно и процедурно.

Локальный drill проверяет код и форматы, но не закрывает production-gates
`offsite_backup` и `restore_drill`. Для них нужен реальный offsite repository,
точные release images и отдельное одноразовое окружение.

## Что резервируется

1. SQLite приложения и Marzban через Python `sqlite3.Connection.backup()`,
   использующий SQLite Online Backup API.
2. Drizzle migrations и deployment configuration из operations image.
3. Marzban/Xray/REALITY configuration из
   `DEPLOY_SECRET_BUNDLE_DIRECTORY`.
4. SHA-256 manifest для несекретных файлов и точный `RELEASE_VERSION`.

Secret bundle сохраняется внутри зашифрованного restic snapshot, но исключается
из SHA-256 manifest. Полные Subscription URL, bot token, webhook secret,
REALITY private key и содержимое env-файлов не выводятся в логи.

## Подготовка

1. Создать offsite restic repository и отдельный password file с правами
   `0600`.
2. Настроить Object Lock и quota alert у storage provider.
3. Заполнить `deployment/backup.env`:

   ```text
   BACKUP_INTERVAL_SECONDS=3600
   RESTIC_REPOSITORY=<offsite repository>
   ```

4. Указать password file через `RESTIC_PASSWORD_FILE_PATH` в
   `deployment/production.env`.
5. Собрать и зафиксировать operations image:

   ```bash
   docker build --target operations -t registry.example/astra-vpn-ops:<release> .
   docker image inspect registry.example/astra-vpn-ops:<release> --format '{{index .RepoDigests 0}}'
   ```

6. Инициализировать новый repository один раз:

   ```bash
   docker compose \
     --env-file deployment/production.env \
     -f deployment/compose.production.yaml \
     run --rm --entrypoint restic backup init
   ```

## Создание и проверка backup

Плановый запуск выполняет сервис `backup`. Разовый запуск до release:

```bash
docker compose \
  --env-file deployment/production.env \
  -f deployment/compose.production.yaml \
  run --rm --entrypoint python3 backup scripts/backup.py
```

Алгоритм:

1. Берётся локальный lock только для backup job.
2. В уникальном каталоге создаются online snapshots обеих SQLite-баз.
3. Для каждой копии выполняются `PRAGMA integrity_check` и
   `PRAGMA foreign_key_check`.
4. Создаётся SHA-256 manifest без secret bundle.
5. Snapshot отправляется в restic с тегами `astra-vpn` и `hourly`.
6. Snapshot повторно находится в offsite repository.
7. `restic check --read-data-subset=1/7` проверяет часть данных.
8. Применяется retention: 48 hourly, 30 daily, 12 weekly, жёсткий предел
   84 дня; только после успешного нового snapshot и check.
9. В `/ops/backup-status.json` атомарно записывается безопасный статус.
10. Временный каталог удаляется; live database не изменяется.

Раз в неделю дополнительно выполнять полный:

```bash
docker compose \
  --env-file deployment/production.env \
  -f deployment/compose.production.yaml \
  run --rm --entrypoint restic backup check --read-data
```

Alert обязателен, если нет успешного snapshot более 65 минут, последний запуск
завершился ошибкой, repository check не прошёл или storage близок к quota.

## Локальный regression drill

Команда создаёт только временные тестовые базы и временный restic repository
внутри одноразового контейнера:

```bash
docker build --target operations -t astra-vpn-operations:drill .
docker run --rm --entrypoint python3 \
  astra-vpn-operations:drill scripts/local_backup_restore_drill.py
```

Ожидаемый итог: `status=ok`, две базы, `withinObjectives=true`.

## Production restore drill

Restore никогда не выполняется в `/source/app`, `/source/marzban`, `/ops` или
поверх существующего target. Скрипт откажется работать при пересечении путей.

1. Создать пустой родительский каталог для drills на отдельном volume.
2. Выбрать конкретный свежий snapshot ID и точный release.
3. Выполнить restore в ещё не существующий дочерний каталог:

   ```bash
   docker compose \
     --env-file deployment/production.env \
     -f deployment/compose.production.yaml \
     run --rm \
     -v /srv/astra-vpn/drills:/drills \
     --entrypoint python3 \
     -e 'RESTORE_LIVE_PATHS_JSON=["/source/app","/source/marzban","/ops"]' \
     backup scripts/restore_drill.py \
       --snapshot <snapshot-id> \
       --target /drills/<change-id> \
       --expected-release <release>
   ```

4. Проверить `restore-drill-evidence.json`: checksum, обе SQLite-проверки,
   `rpoMinutes <= 60`, `rtoMinutes <= 240`.
5. Запустить **точные immutable images** из manifest в отдельном Compose
   project без публичных ports и с `ENABLE_LIVE_OPERATIONS=false`.
6. Через SSH tunnel проверить `/readyz`, вход администратора, чтение тестового
   пользователя, связь заказа с Marzban user и отсутствие секретов в логах.
7. Зафиксировать change ID, snapshot ID, image digests, фактические RPO/RTO,
   результат smoke и найденные проблемы.
8. После принятия evidence безопасно уничтожить одноразовые расшифрованные
   данные по отдельному одобренному действию.

Первый production drill обязателен до запуска; следующие — минимум раз в квартал
и после изменения схемы backup.

## Реальное восстановление

1. Подтвердить инцидент и получить одобрение тимлида.
2. Отключить live operations и остановить записи.
3. Выбрать snapshot по времени инцидента, не просто `latest`.
4. Восстановить только в новые volumes.
5. Повторить checksum, integrity, FK, migration и application smoke.
6. Переключить reverse proxy только на проверенное окружение.
7. Сохранить старые volumes read-only до окончания расследования.

Нельзя удалять старые volumes, запускать migration downgrade или копировать
живой WAL-файл обычной filesystem-командой.
