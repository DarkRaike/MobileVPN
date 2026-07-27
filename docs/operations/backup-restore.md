# Backup and restore runbook

Этот документ фиксирует процедуру. Команды автоматизации добавляются вместе с Docker Compose и volumes, когда появятся реальные имена сервисов и путей. Запрещено подставлять предполагаемые пути в production.

## Цели

- RPO: 60 минут.
- RTO: 4 часа.
- Копии: hourly.
- Offsite: другой provider, account и region.
- Шифрование: restic; пароль или key file находится вне VPS и вне репозитория.
- Object Lock: governance mode минимум 7 дней, если storage поддерживает его.

## Состав копии

1. SQLite приложения, созданная Online Backup API или `.backup`.
2. SQLite Marzban, созданная согласованным online-способом.
3. Drizzle migrations и точный release manifest.
4. Marzban/Xray configuration.
5. REALITY keys и другие секреты отдельным зашифрованным secret bundle с более узким доступом.

Полные Subscription URL, bot token, Telegram webhook secret и REALITY private key запрещено выводить в stdout, структурированные логи или manifest checksums.

## Создание

1. Получить локальный lock только на backup job, не блокируя приложение на время upload.
2. Создать согласованные SQLite snapshots во временном каталоге с правами только для backup-пользователя.
3. Выполнить `PRAGMA integrity_check` и `PRAGMA foreign_key_check` для каждой копии.
4. Сформировать SHA-256 manifest без секретных значений.
5. Отправить snapshot, конфигурацию и manifest в restic repository.
6. Выполнить `restic check` по расписанию и убедиться, что latest snapshot виден из offsite repository.
7. Удалить локальные временные snapshots после подтверждённой загрузки.
8. Записать только время, snapshot ID, размер, длительность и итоговый статус.

Копирование живого SQLite-файла в WAL mode обычным filesystem copy запрещено: такой набор может быть несогласованным.

## Retention

- hourly: 48 часов;
- daily: 30 дней;
- weekly: 12 недель;
- максимальный срок: 84 дня.

Prune выполняется только после успешного нового snapshot и проверки repository. Не следует соединять создание backup и необратимый prune в одну команду без проверки результата.

## Monitoring

Alert создаётся, если:

- нет успешного snapshot более 65 минут;
- integrity check или foreign key check не равен `ok`;
- offsite upload не подтверждён;
- `restic check` завершился ошибкой;
- storage приближается к quota;
- restore drill просрочен.

## Restore drill

Restore никогда не выполняется поверх live volume.

1. Создать чистое одноразовое окружение без доступа пользователей.
2. Получить выбранный restic snapshot по ID.
3. Сверить SHA-256 manifest.
4. Восстановить app DB, Marzban DB, migrations и configuration в новые volumes.
5. Выполнить `integrity_check` и `foreign_key_check`.
6. Запустить точную версию release images из manifest.
7. Проверить вход администратора через tunnel, чтение тестового пользователя, связность локального заказа и Marzban user.
8. Проверить, что логи не раскрыли Subscription URL или секреты.
9. Зафиксировать фактические RPO/RTO, snapshot ID, результат и найденные проблемы.
10. Уничтожить одноразовое окружение и его расшифрованные временные данные.

Первый drill обязателен до production, последующие — минимум раз в квартал и после изменения схемы backup.

## Реальное восстановление

Перед production restore нужны подтверждение инцидента, выбранный snapshot и одобрение тимлида. Сначала останавливаются записи, затем восстанавливаются новые volumes, выполняются проверки и только после этого reverse proxy переключается на проверенное окружение. Старые volumes сохраняются read-only до окончания расследования.
