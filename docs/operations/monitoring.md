# Monitoring and alerting

## Probes

- `GET /healthz` — liveness процесса, не обращается к зависимостям.
- `GET /readyz` — readiness приложения и SQLite schema.
- `GET /api/internal/monitoring` — защищённый operational snapshot; требует
  `X-Monitoring-Secret`, ограничен 60 запросами в минуту на IP.

Внешний uptime-check проверяет `https://app.<baseDomain>/healthz` каждые
60 секунд из двух регионов. `/readyz` используется Docker healthcheck и не
должен публиковать диагностические детали.

### VLESS endpoint

Ни один внутренний сигнал не подтверждает, что клиент может подключиться:
сигналы ниже считают строки в базе и не проверяют доступность `vpn.<baseDomain>`
снаружи. Стек при неисправном endpoint остаётся полностью «здоровым», поэтому
второй внешний uptime-check обязателен — TCP-проба `vpn.<baseDomain>:<VLESS_PORT>`
каждые 60 секунд из тех же регионов.

Проба должна идти именно на DNS-имя, а не на IP: адрес подключения задаётся
записью `vpn`, и её пропажа или проксирование ломает выдачу так же, как
остановленный Xray. Проверка вручную:

```bash
openssl s_client -connect vpn.<domain>:8443 -servername <первый serverName> </dev/null 2>/dev/null | openssl x509 -noout -subject
```

Подлинный subject маскировочного сайта означает, что DNS, порт и REALITY живы.
Отказ соединения — endpoint недоступен; чужой или самоподписанный сертификат —
запись `vpn` ведёт не на VPS.

## Сигналы

| Signal                      | Window/threshold                       | Severity                   |
| --------------------------- | -------------------------------------- | -------------------------- |
| `application_5xx`           | 5 минут; warning 1, critical 5         | warning/critical           |
| `telegram_auth_failures`    | 5 минут; warning 5, critical 10        | warning/critical           |
| `stale_pending_payments`    | pending старше 15 минут; critical 5    | warning/critical           |
| `paid_without_subscription` | paid/provisioning старше 10 минут      | critical при первом случае |
| `provisioning_failures`     | неприменённый failed provisioning      | critical при первом случае |
| `marzban_failures`          | failed с кодом `MARZBAN_*`             | critical при первом случае |
| `support_delivery_failures` | failed или pending старше 5 минут      | warning; critical при 5    |
| `backup_freshness`          | нет success или возраст более 65 минут | critical                   |

Счётчики не содержат Telegram IDs, order IDs, текст обращений, URLs или
секреты. Для одного экземпляра приложения 5xx/auth — bounded in-memory rolling
window; бизнес-сигналы и backup читаются из durable state.

## Alert worker

Сервис `monitoring` опрашивает internal endpoint раз в минуту и отправляет
сообщение в отдельный Telegram operations chat. Требуются:

- `MONITORING_SECRET` — одинаковый в app и monitoring env;
- `TELEGRAM_BOT_TOKEN`;
- `ALERT_TELEGRAM_CHAT_ID`;
- `ALERT_REPEAT_MILLISECONDS`, минимум 5 минут, рекомендуемо 30 минут.

Уведомление отправляется при изменении active signals, восстановлении и
повторяется для незакрытой проблемы. В alert нет секретов и идентификаторов
пользователей.

## Реакция

1. Подтвердить alert через `/api/internal/monitoring` только из private network.
2. Сопоставить время с JSON logs по `requestId`, `errorCode`, route и status.
3. Для Stars не подтверждать оплату вручную по клиентскому callback.
4. Для provisioning сначала сверить фактическое состояние Marzban, затем
   использовать идемпотентный retry.
5. Для backup остановить release до нового проверенного offsite snapshot.
6. При 5xx/Marzban outage отключить live operations; rollback выполнять по
   `release-checklist.md`.

Полный Prometheus/Grafana stack не добавляется без измеримой необходимости.
