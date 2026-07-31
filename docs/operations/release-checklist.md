# Release checklist and rollback

## Hard stop

Release запрещён, пока хотя бы один gate в
`contracts/stage-0.decisions.json` равен `false`, `productionReady=false`,
отсутствует тимлид review или нет свежего offsite backup. Нельзя обходить gate
изменением env или локальной правкой build artifact.

## Подготовка

- [ ] PR содержит один связный release scope и Conventional Commits.
- [ ] `npm ci` и `npm run check` прошли на чистом checkout.
- [ ] Playwright Chromium установлен; `npm run test:e2e` прошёл.
- [ ] `npm audit`/SBOM/CVE evidence сохранено; решения по advisories приняты.
- [ ] Marzban/Xray image scan и contract snapshot проверены тимлидом.
- [ ] Все production-readiness gates закрыты доказательствами.
- [ ] Telegram iOS/Android/Desktop smoke заполнен и подписан.
- [ ] Host firewall публикует только 80/443/8443; SSH ограничен operator IP.
- [ ] DNS/HTTPS, webhook secret, REALITY target/SAN/time sync проверены.
- [ ] Secret files имеют `0600`, не находятся в Git/image/command history.
- [ ] App и operations images собраны CI и загружены на VPS под тегом
      `RELEASE_VERSION`; их digest записан в release evidence.
- [ ] Migration проверена на clean DB и предыдущей схеме; downgrade strategy
      записана.
- [ ] Последний offsite backup моложе 60 минут и repository check успешен.
- [ ] Restore drill моложе квартала и укладывается в RPO/RTO.
- [ ] Change window, ответственный и rollback decision owner назначены.

## Deploy

1. Зафиксировать текущие image digests, volume names и backup snapshot ID.
2. Проверить итоговую конфигурацию без вывода env:

   ```bash
   docker compose \
     --env-file deployment/production.env \
     -f deployment/compose.production.yaml config --quiet
   ```

3. Выполнить разовый backup из `backup-restore.md`.
4. Загрузить собранные CI образы под тегами
   `astra-vpn-app:${RELEASE_VERSION}` и
   `astra-vpn-operations:${RELEASE_VERSION}`, получить внешние образы по digest
   и запустить без build:

   ```bash
   docker compose \
     --env-file deployment/production.env \
     -f deployment/compose.production.yaml pull --ignore-buildable
   docker compose \
     --env-file deployment/production.env \
     -f deployment/compose.production.yaml up -d --no-build
   ```

5. Проверить `docker compose ps`, healthchecks и отсутствие restart loop.
6. Проверить HTTPS/security headers, `/healthz`, `/readyz`, закрытые Marzban
   routes на subscription host и отсутствие публичных 3000/8000/2019.
7. Проверить internal monitoring: все signals `ok`.
8. Выполнить контролируемый smoke без повторного использования payment payload.
9. Наблюдать минимум 30 минут: 5xx, auth failures, payments, paid-without-sub,
   provisioning, Marzban, support delivery, backup.
10. Сохранить release evidence; CD не используется.

## Rollback criteria

Начать rollback при любом из условий:

- подтверждённая ошибка auth/authorization или утечка секрета;
- webhook/payment mismatch, duplicate provisioning/refund;
- health/readiness не восстанавливается 5 минут;
- `application_5xx` critical или растущий paid-without-subscription;
- Marzban недоступен и controlled retry не помогает;
- migration нарушила integrity/FK или backup freshness потеряна.

## Rollback

1. Немедленно установить `ENABLE_LIVE_OPERATIONS=false` в app/worker secret
   env и пересоздать только эти сервисы. Это останавливает новые invoices и
   provisioning, но сохраняет данные.
2. Не удалять volumes и не запускать destructive Git/SQLite команды.
3. Если schema backward-compatible, вернуть предыдущие app/operations image
   digests и выполнить `up -d --no-build`.
4. Если schema несовместима, не запускать старый image на новой live DB:
   остановить записи, восстановить выбранный pre-release snapshot **в новые
   volumes**, проверить его по restore runbook, затем переключить proxy.
5. Сверить Telegram successful payments, пришедшие в change window, через
   безопасную reconciliation процедуру; не выдавать доступ вручную по callback.
6. Проверить health, monitoring и один controlled read-only smoke.
7. Сохранить старые volumes read-only для расследования и оформить incident.

Rollback считается завершённым только после восстановления probes, отсутствия
новых critical signals и подтверждения целостности платежей/подписок.
