# Развёртывание на VPS с нуля

Пошаговая процедура для чистого сервера. Довести до конца нужно все шаги: часть
из них ломает VPN молча — стек остаётся «здоровым», подписка выдаётся, а клиент
не подключается. Такие места отмечены отдельно.

Углублённые материалы: [vps-deployment.md](docs/operations/vps-deployment.md)
(что делает каждый сервис), [monitoring.md](docs/operations/monitoring.md),
[backup-restore.md](docs/operations/backup-restore.md),
[release-checklist.md](docs/operations/release-checklist.md).

## 0. Что понадобится

- VPS: 2 vCPU, 2 GB RAM, 20 GB диска, Ubuntu 22.04/24.04 или Debian 12;
- собственный домен с доступом к DNS;
- Telegram-бот и ваш Telegram user ID;
- root или sudo на сервере.

Публичный IP должен быть выделенным. За NAT или behind Cloudflare proxy REALITY
не работает.

## 1. Домен и DNS

Три `A`-записи на публичный IP VPS:

| Тип | Имя   | Роль                                    |
| --- | ----- | --------------------------------------- |
| A   | `app` | Mini App и `POST /api/telegram/webhook` |
| A   | `sub` | Marzban `/sub/*`                        |
| A   | `vpn` | VLESS REALITY на порту 8443             |

> **Молчаливый обрыв №1.** Запись `vpn` — это адрес подключения внутри каждой
> клиентской конфигурации. Без неё выданные подписки не резолвятся, а приложение
> об этом не узнает. Если DNS обслуживает Cloudflare, проксирование должно быть
> выключено для **всех трёх** записей (серое облако): оранжевое облако подменяет
> TLS на `app`/`sub` и полностью ломает REALITY на `vpn`.

Проверьте, что записи разошлись, прежде чем запускать стек — Caddy выпускает
сертификаты по HTTP-01 challenge и без корректного DNS получит отказ:

```bash
dig +short app.example.com sub.example.com vpn.example.com
```

## 2. Порты

На хосте нужны открытыми `22/tcp` (по возможности только с вашего IP),
`80/tcp`, `443/tcp`, `443/udp` и `8443/tcp`.

```bash
ufw allow 80/tcp && ufw allow 443 && ufw allow 8443/tcp && ufw --force enable && ufw status
```

> **Молчаливый обрыв №2.** У облачных провайдеров кроме хостового firewall есть
> собственный сетевой фильтр, и он важнее: в Yandex Cloud это security group, в
> AWS — тоже security group, в GCP — VPC firewall rules. Типовая заготовка
> открывает `22`, `80`, `443` — и `8443` остаётся закрытым. Снаружи это
> выглядит как полностью исправный сервис при нулевом трафике VPN. Правило для
> `8443/tcp` из `0.0.0.0/0` нужно добавить в консоли провайдера отдельно.

Проверять надо **снаружи** VPS, не с самого сервера:

```bash
nc -vz vpn.example.com 8443
```

## 3. Подготовка сервера

Docker Engine с Compose plugin:

```bash
curl -fsSL https://get.docker.com | sh && docker compose version
```

Синхронизация времени:

```bash
timedatectl set-ntp true && timedatectl
```

> **Молчаливый обрыв №3.** REALITY отбраковывает рукопожатие при слишком большом
> расхождении часов клиента и сервера. В выводе `timedatectl` должно быть
> `System clock synchronized: yes` и `NTP service: active`. Расхождение в
> несколько минут выглядит как «сервер работает, клиент не подключается».

## 4. Telegram-бот

1. В [@BotFather](https://t.me/BotFather) создайте бота и сохраните токен.
2. `/newapp` — создайте Mini App и укажите URL `https://app.example.com`.
3. Узнайте свой Telegram user ID у [@userinfobot](https://t.me/userinfobot).
4. Включите двухэтапную аутентификацию на аккаунте владельца бота.

Webhook на этом этапе не регистрируется — это отдельный шаг 8, он требует уже
выпущенного сертификата.

## 5. Код и конфигурация

```bash
git clone https://github.com/DarkRaike/MobileVPN.git /srv/astra && cd /srv/astra
```

Каталог вне `/root` выбран намеренно: домашний каталог root имеет режим `0700`,
и любой не-root пользователь, которому вы позже дадите доступ к стеку, туда не
пройдёт.

```bash
cp deployment/production.env.example deployment/production.env
```

Заполните `deployment/production.env`. Обязательны:

| Переменная               | Значение                                 |
| ------------------------ | ---------------------------------------- |
| `BASE_DOMAIN`            | `example.com` — без `app.`/`sub.`/`vpn.` |
| `ACME_EMAIL`             | почта для Let's Encrypt                  |
| `TELEGRAM_BOT_TOKEN`     | токен из BotFather                       |
| `TELEGRAM_ADMIN_USER_ID` | ваш Telegram user ID, только цифры       |
| `RELEASE_VERSION`        | тег образов, например `0.1.0`            |

Остальное можно оставить по умолчанию. `ENABLE_LIVE_OPERATIONS` пока `false` —
включим на шаге 9.

Секреты сюда вписывать не нужно и нельзя: `SESSION_SECRET`, ключи REALITY,
пароль Marzban, webhook secret и ключ шифрования подписок генерирует сервис
`bootstrap` при первом запуске.

Домены `.example`, `.test` и `localhost` конфигурация отклоняет — заглушка из
примера не запустится.

## 6. Первый запуск

```bash
docker compose --env-file deployment/production.env -f deployment/compose.production.yaml up -d --build
```

Одна команда доводит стек до рабочего состояния: генерация секретов и Xray
config, миграции Marzban, администратор Marzban, адрес proxy host, миграции
приложения, seed тарифов, выпуск сертификатов.

Состояние:

```bash
docker compose --env-file deployment/production.env -f deployment/compose.production.yaml ps
```

Все долгоживущие сервисы должны быть `running`, а `healthy` — у `app`,
`marzban`, `reverse-proxy`. One-shot сервисы (`bootstrap`, `marzban-init`,
`app-init`) остаются `exited (0)` — это нормально.

Повторный запуск той же команды безопасен: существующие секреты, ключи REALITY
и базы сохраняются.

## 7. Проверка HTTPS

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://app.example.com/healthz
```

Ожидается `200`. Если сертификат не выпустился, смотрите логи Caddy:

```bash
docker compose --env-file deployment/production.env -f deployment/compose.production.yaml logs --tail=50 reverse-proxy
```

Хост подписки должен отдавать ответ Marzban, а не пустой `404` от Caddy:

```bash
curl -sS -D- -o /dev/null https://sub.example.com/sub/invalid-token
```

В заголовках должен быть `content-type: application/json`.

## 8. Регистрация webhook

Отдельная явная операция — она меняет настройки бота на стороне Telegram:

```bash
docker compose --env-file deployment/production.env -f deployment/compose.production.yaml --profile telegram run --rm telegram-webhook
```

Без этого шага `message.successful_payment` не дойдёт до приложения, и оплата
никогда не превратится в VPN-доступ.

## 9. Включение живых операций

> **Молчаливый обрыв №4.** `ENABLE_LIVE_OPERATIONS=false` — состояние по
> умолчанию. Приложение и Marzban при нём работают, витрина открывается, но
> реальный VPN не выдаётся: provisioning падает с `LIVE_OPERATIONS_DISABLED`, а
> заказ уходит в `provisioning_failed`. Это легко принять за поломку VPN.

Перед включением закройте gates из
[production-readiness.md](docs/operations/production-readiness.md) — юридический
и налоговый статус, оферта, 2FA владельца бота, offsite backup и restore drill.
Флаг разрешён только при закрытых gates: иначе приложение осознанно не стартует.

Поставьте `ENABLE_LIVE_OPERATIONS=true` в `deployment/production.env` и
пересоздайте затронутые сервисы:

```bash
docker compose --env-file deployment/production.env -f deployment/compose.production.yaml up -d --force-recreate app worker monitoring
```

> `--force-recreate` обязателен. Секреты генерируются после разбора
> Compose-файла и подставляются на старте контейнера, поэтому Compose не видит
> изменений внутри сгенерированных env-файлов и обычный `up -d` их не подхватит.

## 10. Проверка выдачи VPN

Выдайте себе доступ без оплаты: откройте Mini App, зайдите в `/admin` →
«Доступ» и выдайте подписку на свой Telegram user ID. Затем в профиле должны
появиться срок, Subscription URL и QR-код.

Импортируйте ссылку в клиент (v2rayNG, Hiddify, streisand) и подключитесь.

Полная проверка цепочки одной командой:

```bash
docker compose --env-file deployment/production.env -f deployment/compose.production.yaml exec -T --user root app node scripts/vpn-diagnose.mjs
```

Скрипт проходит тот же путь, что и клиент, и называет первый сломанный шаг:

| Шаг                   | `fail` означает                                                           |
| --------------------- | ------------------------------------------------------------------------- |
| `marzban_admin_token` | пароли стека и Marzban разошлись                                          |
| `xray_core`           | Marzban работает, но Xray не запустился — порт закрыт при «зелёном» стеке |
| `inbound_resolved`    | Marzban не принял отрендеренный Xray config                               |
| `advertised_endpoint` | клиентам выдаётся не тот адрес или порт                                   |
| `dns_record`          | шаг 1: записи `vpn` нет или она не резолвится                             |
| `port_reachable`      | шаг 2: порт закрыт firewall или security group                            |
| `reality_masquerade`  | на порту отвечает не Xray; чужой issuer — проксированная DNS-запись       |
| `user_links`          | подписка выдана без конфигураций                                          |

`chain_intact` при неработающем клиенте означает, что соединение доходит до
Xray и отбивается на аутентификации. Тогда — логи ядра:

```bash
docker compose --env-file deployment/production.env -f deployment/compose.production.yaml exec -T --user root app node scripts/xray-core-logs.mjs 30
```

Отклонённый REALITY-хендшейк не виден на уровне `warning`, поэтому на время
разбора поднимите `XRAY_LOG_LEVEL=info` в `production.env` и пересоздайте
`bootstrap` и `marzban`. Обычный `docker compose logs marzban` тут бесполезен:
Marzban перехватывает вывод Xray во внутренний буфер и отдаёт только через API.

## 11. Резервные копии

Ежечасный restic backup выключен по умолчанию, чтобы стек поднимался без
внешнего хранилища. Включение — `deployment/backup.env` по примеру,
`COMPOSE_PROFILES=backup` в `production.env`, перезапуск стека и процедуры из
[backup-restore.md](docs/operations/backup-restore.md).

Каталог `deployment/secrets` нужно скопировать в защищённое хранилище вне VPS.
Потеря `SUBSCRIPTION_URL_ENCRYPTION_KEY` делает сохранённые Subscription URL
нечитаемыми, потеря приватного ключа REALITY требует перевыпуска всех клиентских
конфигураций.

## 12. Обновление

```bash
cd /srv/astra && git pull && docker compose --env-file deployment/production.env -f deployment/compose.production.yaml up -d --build
```

Перед выпуском пройдите [release-checklist.md](docs/operations/release-checklist.md).

## Пять мест, где ломается чаще всего

1. **Запись `vpn` отсутствует или проксирована.** Клиентские конфигурации
   адресуются по имени; подписка при этом выдаётся нормально.
2. **`8443/tcp` закрыт в security group провайдера.** Хостовый `ufw` открыт, а
   облачный фильтр — нет.
3. **Часы сервера не синхронизированы.** REALITY отбраковывает рукопожатие.
4. **`ENABLE_LIVE_OPERATIONS` остался `false`.** VPN не выдаётся вообще.
5. **`production.env` изменён без `--force-recreate`.** Контейнеры продолжают
   работать со старыми значениями.

Первые три не видны ни в одном логе приложения и ни в одном сигнале мониторинга.
Именно их проверяет `scripts/vpn-diagnose.mjs` — начинайте разбор с него.
