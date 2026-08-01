# Этап 0: фиксация внешних решений

Дата фиксации: 2026-07-27. Машиночитаемый источник решений — [`contracts/stage-0.decisions.json`](../../contracts/stage-0.decisions.json).

Этап закрывает архитектурные TBD и заменяет неизвестные внешние факты явными production gates. Пока хотя бы один gate не подтверждён доказательством, приложение обязано завершать production-запуск с ошибкой конфигурации.

## Telegram Stars

В первой версии используется только **Telegram Stars**. Для цифрового VPN-доступа внутри Telegram это обязательный способ оплаты. Внешний эквайринг откладывается: будущий провайдер выбирается отдельным решением и не требует абстракций в текущем коде.

Фиксированные параметры:

- Bot API — документация версии 10.2 на дату решения;
- валюта — `XTR`;
- цены — 99/249/599 Stars за 7/30/90 дней;
- расчёты и хранение — только целое количество Stars;
- одноразовый invoice без рекуррентного списания;
- invoice создаётся сервером через `createInvoiceLink`;
- `provider_token` — пустая строка;
- `prices` содержит ровно один `LabeledPrice`;
- `invoice_payload` — `v1:<payment-attempt-uuid>`, не более 128 байт;
- Mini App открывает ссылку через `Telegram.WebApp.openInvoice()` по прямому пользовательскому действию.

Callback `openInvoice`, включая `paid`, используется только для интерфейса. Он не выдаёт VPN-доступ.

### Webhook и pre-checkout

Все bot updates приходят на `POST /api/telegram/webhook`. `setWebhook` настраивается с отдельным `secret_token`; сервер проверяет `X-Telegram-Bot-Api-Secret-Token`, ограничивает тело 64 KiB и дедуплицирует `update_id`.

На `pre_checkout_query` нужно ответить через `answerPreCheckoutQuery` не позднее 10 секунд. До `ok=true` сервер сверяет Telegram user ID, payload, `currency=XTR`, сумму, статус заказа и 365-дневный предел подписки. Успешный pre-checkout ещё не означает, что оплата состоялась.

VPN выдаётся только после серверного `message.successful_payment`. Проверяются:

1. Telegram user ID;
2. `invoice_payload`;
3. `currency=XTR`;
4. `total_amount`;
5. непустой `telegram_payment_charge_id`;
6. уникальность `update_id` и charge ID;
7. отсутствие ранее применённого provisioning.

Событие сохраняется до запуска Marzban. Для reconciliation используется `getStarTransactions`, поскольку Telegram хранит непринятые updates не более 24 часов.

### Возвраты и защита пользователя

Полный возврат выполняется серверным `refundStarPayment(user_id, telegram_payment_charge_id)`. Частичные возвраты первой версии не поддерживаются. Refund идемпотентен и отзывает только срок, выданный возвращённым заказом.

Бот предоставляет `/terms` и `/paysupport`; пользователь принимает условия до создания invoice. Владелец бота самостоятельно обрабатывает споры. До production специалист подтверждает юридический статус, налогообложение, необходимость чеков, оферту, privacy/refund policy и законность VPN.

## Домены и reverse proxy

Базовый домен ещё не передан владельцем проекта, поэтому зафиксированы роли:

| Имя                | Назначение                                    |
| ------------------ | --------------------------------------------- |
| `app.{baseDomain}` | Mini App, legal pages и Telegram webhook      |
| `sub.{baseDomain}` | только Marzban subscription endpoint `/sub/*` |
| `vpn.{baseDomain}` | VLESS/REALITY endpoint                        |

Xray слушает публичный 443 и отдаёт неаутентифицированные соединения Caddy, который держит HTTPS на внутреннем 8443. Публично открыты только 80 и 443. SSH 22 доступен только по allowlist оператора. Порты приложения 3000, Marzban 8000 и Caddy admin 2019 находятся только во внутренней сети.

На `sub.{baseDomain}` запрещены `/api/*`, `/dashboard/*`, `/docs` и `/openapi.json`; access log отключён. Публичного admin-домена нет, Marzban admin доступен только через SSH tunnel.

## Marzban и OpenAPI

Зафиксированы:

- Marzban `v0.8.4`;
- commit `7f396db3e703d71a28060bc9ce4a532ec64cb1f4`;
- OCI image index `gozargah/marzban:v0.8.4@sha256:8e422c21997e5d2e3fa231eeff73c0a19193c20fc02fa4958e9368abb9623b8d`;
- OpenAPI snapshot `contracts/marzban/openapi.v0.8.4.json`;
- SHA-256 snapshot `1f38142daa8a4b636ed11b16e9511583df81cc5373db964f88fd94206f1608dc`.

Адаптер использует только `POST /api/admin/token`, `GET /api/user/{username}`, `POST /api/user` и `PUT /api/user/{username}` по приватной Docker-сети.

Релиз старый, поэтому до production обязательны SBOM/CVE-проверка образа и bundled Xray, фиксация результата и ревью тимлида.

## VLESS/REALITY

Первая версия использует:

- inbound `VLESS TCP REALITY`;
- VLESS + RAW/TCP;
- TCP 443;
- REALITY;
- flow отсутствует (обычный VLESS);
- `data_limit=0`, стратегия `no_reset`.

Три устройства — soft policy. REALITY target измеряется с production VPS через `xray tls ping`; X25519 keys и случайный 16-символьный hex `shortId` не хранятся в Git.

## Данные и backup

Backup:

- RPO — не более 60 минут;
- RTO — не более 4 часов;
- SQLite копируется Online Backup API или `.backup`;
- restic отправляет зашифрованные копии в другой provider/account/region;
- retention: 48 часов hourly, 30 дней daily, 12 недель weekly, максимум 84 дня;
- проверяются `integrity_check`, `foreign_key_check` и SHA-256 manifest;
- restore drill выполняется до production и затем ежеквартально.

Полный runbook: [`docs/operations/backup-restore.md`](../operations/backup-restore.md).

## Дизайн

Visual reference — `vpn-mini-app.html`: тёмный фон, rounded cards, синий accent, приглушённый secondary text и Inter. Рублёвые подписи в reference не являются актуальным платёжным контрактом; интерфейс первой версии показывает Stars.

## Автоматическая проверка

`npm run check` выполняет format check, lint, typecheck, contract tests и сборку детерминированного contract bundle. Тесты не обращаются в сеть. GitHub Actions содержит только CI, без CD и staging.

## Источники

- [Telegram Stars для цифровых товаров и услуг](https://core.telegram.org/bots/payments-stars)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegram Mini App `openInvoice`](https://core.telegram.org/bots/webapps)
- [Marzban v0.8.4](https://github.com/Gozargah/Marzban/releases/tag/v0.8.4)
- [Marzban API](https://gozargah.github.io/marzban/en/docs/api)
- [Xray REALITY](https://xtls.github.io/en/config/transports/reality.html)
- [SQLite Online Backup API](https://www.sqlite.org/backup.html)
- [SQLite WAL](https://www.sqlite.org/wal.html)
- [restic encryption](https://restic.readthedocs.io/en/stable/070_encryption.html)
