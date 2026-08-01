# Развёртывание приложения и Marzban на одном VPS

Документ описывает, как один Docker Compose stack поднимает Marzban, Xray с
REALITY и Telegram Mini App на одном сервере, и что остаётся ручной операцией.

## 1. Анализ предыдущей конфигурации

`deployment/compose.production.yaml` описывал целевую архитектуру, но не мог
быть запущен без большой ручной подготовки. Конкретные пробелы:

| Пробел                                                                                                                                                                                                                           | Последствие                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Обязательные `APP_IMAGE`, `OPERATIONS_IMAGE`, `APP_ENV_FILE`, `WORKER_ENV_FILE`, `MONITORING_ENV_FILE`, `MARZBAN_ENV_FILE`, `BACKUP_ENV_FILE`, `XRAY_CONFIG_FILE`, `RESTIC_PASSWORD_FILE_PATH`, `DEPLOY_SECRET_BUNDLE_DIRECTORY` | `docker compose up` завершался ошибкой: ни один из файлов не существовал в репозитории                  |
| Не было шаблона Xray config и генерации X25519/shortId                                                                                                                                                                           | REALITY inbound `VLESS_TCP_REALITY_V1` не существовал, VPN не выдавался                                 |
| Marzban admin не создавался                                                                                                                                                                                                      | `POST /api/admin/token` возвращал ошибку, provisioning падал на первом же заказе                        |
| `XRAY_SUBSCRIPTION_URL_PREFIX` оставался пустым                                                                                                                                                                                  | Marzban возвращал `subscription_url` без host, QR и ссылка были нерабочими                              |
| `app` и `monitoring` находились только в сети `backend` с `internal: true`                                                                                                                                                       | исходящие вызовы `api.telegram.org` невозможны: invoice, pre-checkout, поддержка и alerting не работали |
| Production image не содержал seed тарифов                                                                                                                                                                                        | на чистой базе «Главная» оставалась пустой                                                              |
| `backup` входил в набор по умолчанию и требовал restic repository                                                                                                                                                                | без настроенного offsite storage сервис уходил в restart loop                                           |
| Telegram webhook нигде не регистрировался                                                                                                                                                                                        | `message.successful_payment` не доходил до приложения                                                   |
| `UVICORN_HOST=0.0.0.0` без SSL-файлов игнорируется Marzban                                                                                                                                                                       | Marzban слушал только `127.0.0.1`, и `http://marzban:8000` из приложения давал `ECONNREFUSED`           |

Правильными и сохранёнными остались: pinned images по digest, `read_only`
контейнеры, `cap_drop: ALL`, `no-new-privileges`, разделение volumes приложения
и Marzban, закрытие `/api/*` и `/dashboard/*` на subscription host и отключённый
на нём access log.

## 2. Что делает один stack

| Сервис             | Роль                                                                        |
| ------------------ | --------------------------------------------------------------------------- |
| `bootstrap`        | one-shot: генерирует секреты, REALITY-ключи, `xray_config.json` и env-файлы |
| `marzban-init`     | one-shot: `alembic upgrade head`, пароль sudo-админа и адрес proxy host     |
| `app-init`         | one-shot: Drizzle migrations и идемпотентный seed тарифов 7/30/90           |
| `marzban`          | Marzban на Unix-сокете и Xray REALITY на `8443/tcp`                         |
| `app`              | SvelteKit Node server на внутреннем `3000`                                  |
| `worker`           | reconciliation и provisioning retry                                         |
| `monitoring`       | внутренние сигналы и Telegram alerting                                      |
| `reverse-proxy`    | Caddy, HTTPS, три host role и приватный доступ к Marzban API                |
| `backup`           | profile `backup`: ежечасный restic snapshot                                 |
| `telegram-webhook` | profile `telegram`: разовый `setWebhook`                                    |

Порядок запуска задан через `depends_on` с
`condition: service_completed_successfully`, поэтому одна команда доводит стек
до рабочего состояния без промежуточных ручных шагов.

Секреты генерируются после разбора Compose-файла, поэтому сервисы не могут
получить их через `env_file`. Вместо этого `deployment/bootstrap/with-env.sh`
загружает нужный файл на старте контейнера и запускает реальную команду.

Обратная сторона: Compose не видит изменений внутри сгенерированных env-файлов,
поэтому после правки `deployment/production.env` затронутые сервисы нужно
пересоздавать явно:

```bash
docker compose --env-file deployment/production.env -f deployment/compose.production.yaml up -d --force-recreate app worker monitoring
```

### Доступ к Marzban API

Без `UVICORN_SSL_CERTFILE` Marzban намеренно слушает только loopback, поэтому
он запускается на Unix-сокете в отдельном volume `marzban-socket` — это вариант,
который рекомендует сам Marzban. Caddy проксирует сокет и владеет сетевым
алиасом `marzban` в сети `backend`, поэтому `MARZBAN_BASE_URL=http://marzban:8000`
из `tech.md` продолжает работать без изменений в приложении.

Контейнер Marzban при этом не подключён к `backend`: он остаётся только в
`vpn-egress`, и до его API нельзя достучаться в обход reverse proxy.

### Маршруты на `sub`

Хост подписки описан блоками `handle`, а не отдельными директивами. Caddy
упорядочивает голые директивы по собственному списку, в котором `respond` идёт
раньше `reverse_proxy`: замыкающий `respond 404` в таком блоке отвечает на все
запросы, а проксирование `/sub/*` становится недостижимым, и любая ссылка
подписки отдаёт пустой `404`. Блоки `handle` взаимоисключающие и применяются в
порядке записи, поэтому маршрут остаётся рабочим.

Проверить снаружи можно так: невалидный токен должен вернуть ответ Marzban с
`content-type: application/json`, а не пустой `404` от Caddy.

```bash
curl -sS -D- -o/dev/null https://sub.example.com/sub/invalid-token
```

## 3. DNS

До первого запуска у регистратора домена создаются три `A`-записи на публичный
IP VPS:

| Тип | Имя   | Значение   | Роль                                    |
| --- | ----- | ---------- | --------------------------------------- |
| A   | `app` | `<IP VPS>` | Mini App и `POST /api/telegram/webhook` |
| A   | `sub` | `<IP VPS>` | Marzban `/sub/*`                        |
| A   | `vpn` | `<IP VPS>` | VLESS REALITY на `VLESS_PORT`           |

Запись `vpn` обязательна: именно она попадает в клиентские конфигурации как
адрес подключения (см. «Адрес, который получает клиент»).

Если DNS обслуживает Cloudflare, для всех трёх записей проксирование должно быть
выключено (серое облако): оранжевое облако подменяет TLS на `app`/`sub` и
полностью ломает REALITY на `vpn`.

Записи должны разойтись до `up -d`: Caddy запрашивает сертификаты по
HTTP-01 challenge и без корректного DNS получит отказ.

## 4. Запуск на VPS

1. Установить Docker Engine с Compose plugin и открыть в firewall только
   `80/tcp`, `443/tcp`, `443/udp`, `8443/tcp` и SSH по operator IP allowlist.
2. Склонировать репозиторий и подготовить конфигурацию:

   ```bash
   cp deployment/production.env.example deployment/production.env
   ```

3. Заполнить `BASE_DOMAIN`, `ACME_EMAIL`, `TELEGRAM_BOT_TOKEN` и
   `TELEGRAM_ADMIN_USER_ID`. Остальные значения имеют рабочие значения по
   умолчанию.
4. Поднять весь стек одной командой:

   ```bash
   docker compose --env-file deployment/production.env -f deployment/compose.production.yaml up -d --build
   ```

5. Проверить состояние:

   ```bash
   docker compose --env-file deployment/production.env -f deployment/compose.production.yaml ps
   ```

Повторный запуск той же команды безопасен: существующие секреты, ключи REALITY,
база Marzban и база приложения сохраняются.

Если образы собираются в CI, их достаточно загрузить на VPS под тегами
`astra-vpn-app:${RELEASE_VERSION}` и `astra-vpn-operations:${RELEASE_VERSION}` и
запускать стек с `--no-build`.

## 5. Что генерируется автоматически

`bootstrap` создаёт файлы в `DEPLOY_SECRET_DIRECTORY` (по умолчанию
`deployment/secrets`, каталог `0711`, вне Git и вне build context):

| Файл                     | Содержимое                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `generated-secrets.json` | постоянное хранилище сгенерированных значений                                                                                                   |
| `app.env`                | `SESSION_SECRET`, `SUBSCRIPTION_URL_ENCRYPTION_KEY`, `INTERNAL_JOB_SECRET`, `MONITORING_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, Marzban credentials |
| `worker.env`             | секреты reconciliation worker                                                                                                                   |
| `monitoring.env`         | секреты и параметры alerting                                                                                                                    |
| `marzban.env`            | `UVICORN_UDS`, `XRAY_JSON`, `XRAY_SUBSCRIPTION_URL_PREFIX`                                                                                      |
| `marzban-init.env`       | то же плюс `SUDO_USERNAME`, `SUDO_PASSWORD` и адрес proxy host для синхронизации админа и endpoint                                              |
| `xray_config.json`       | inbound `VLESS_TCP_REALITY_V1` с приватным ключом и short ID                                                                                    |
| `reality-client.json`    | публичные параметры подключения: public key, short ID, SNI, порт                                                                                |
| `restic_password`        | пароль restic repository                                                                                                                        |

Значения создаются один раз и переживают перезапуски. Файлы приложения
принадлежат `APP_UID:APP_GID` с режимом `0400`, остальные — `root` с `0600`.

Каталог секретов необходимо скопировать в защищённое хранилище вне VPS. Потеря
`SUBSCRIPTION_URL_ENCRYPTION_KEY` делает сохранённые Subscription URL
нечитаемыми, а потеря приватного ключа REALITY требует перевыпуска всех
клиентских конфигураций.

Ротация выполняется удалением конкретного ключа из `generated-secrets.json` и
повторным запуском стека.

## 6. Домен-заглушка

`BASE_DOMAIN=example.com` в примере — заглушка. До покупки домена:

- стек поднимается полностью, приложение и Marzban работают по внутренней сети;
- Caddy не сможет выпустить сертификаты, поэтому публичный HTTPS недоступен;
- для проверок можно указать `ACME_CA` на staging Let's Encrypt, чтобы не
  расходовать production rate limits.

После покупки домена нужно создать записи `app`, `sub` и `vpn` на IP VPS,
заменить `BASE_DOMAIN` и перезапустить стек. `BASE_DOMAIN` участвует в проверке
конфигурации приложения: домены `.example`, `.test` и `localhost` отклоняются.

## 7. Marzban

Учётная запись администратора создаётся автоматически из `SUDO_USERNAME` и
`SUDO_PASSWORD`; пароль находится в `deployment/secrets/generated-secrets.json`.
Креды попадают только в `marzban-init.env`, который читает разовый init-сервис;
работающий контейнер Marzban их не получает.

На Marzban `v0.8.4` команда `admin import-from-env` умеет только создавать
администратора: её ветка синхронизации падает на валидации
`AdminPartialModify`. Поэтому обновление пароля выполняет
`deployment/bootstrap/marzban_admin_sync.py`: при каждом старте он сверяет
сохранённый bcrypt-хеш с текущим `SUDO_PASSWORD` и приводит его в соответствие,
а импорт запускается только когда админа ещё нет. Хеш, записанный другой схемой,
скрипт не трогает и останавливает запуск, чтобы не отрезать доступ к панели.

Это делает стек сходящимся: если том `marzban-data` пережил перегенерацию
`generated-secrets.json`, приложение и Marzban оказываются с разными паролями, и
до появления синхронизации выдача навсегда падала с `MARZBAN_CREDENTIALS_REJECTED`
(в более старых сборках — `MARZBAN_AUTH_FAILED`). Восстановление — обычный
перезапуск стека.

Менять пароль правкой env не нужно: он берётся из
`generated-secrets.json`. Ротация — удалить `MARZBAN_PASSWORD` из этого файла и
перезапустить стек.

Порт `8000` не публикуется. Для доступа к панели используется временный
override и SSH tunnel:

```bash
docker compose --env-file deployment/production.env -f deployment/compose.production.yaml -f deployment/compose.admin-tunnel.yaml up -d reverse-proxy
```

```bash
ssh -N -L 8000:127.0.0.1:8000 operator@vps
```

После работы override нужно убрать и пересоздать сервис без него.

Xray config подключается read-only, поэтому изменения ядра из панели не
сохраняются: конфигурация меняется только через
`deployment/xray/xray_config.template.json` и переменные стека.

### Адрес, который получает клиент

Marzban при первом появлении inbound создаёт proxy host с адресом
`{SERVER_IP}`. Этот placeholder раскрывается один раз за старт запросом к
внешнему echo-сервису (`api4.ipify.org`, `ipv4.icanhazip.com`, `ifconfig.io`) и
при недоступности любого из них падает до `127.0.0.1`. Значение попадает в
каждую выданную подписку без проверок, поэтому одна неудачная попытка раздаёт
конфигурации, которые не могут подключиться, при полностью «здоровом» стеке.

Поэтому адрес задаёт `deployment/bootstrap/marzban_host_sync.py`: при каждом
старте он приводит proxy host к `vpn.<domain>` на `VLESS_PORT`. SNI, security и
fingerprint остаются унаследованными от inbound, так что host не может разойтись
с отрендеренным Xray config. Скрипт занимает строку `inbounds` до старта
Marzban, поэтому default с `{SERVER_IP}` больше не создаётся, а на уже
работающем стеке — переносится на домен.

Ничего не удаляется: если в панели заведены собственные host-записи, скрипт
сообщает об этом и не трогает список.

Отсюда требование к DNS: запись `vpn.<domain>` обязана быть A/AAAA **без
проксирования** (в Cloudflare — серое облако). Проксированная запись отдаёт
чужой IP и ломает REALITY. Проверяется шагами `dns_record` и
`reality_masquerade` в `scripts/vpn-diagnose.mjs`.

Пока запись недоступна, адрес можно временно задать напрямую через
`REALITY_ENDPOINT_HOST` в `deployment/production.env`. Это аварийный вариант:
IP попадает во все выданные конфигурации, и при смене сервера подписки придётся
перевыпускать.

### Пустой short ID в первой ссылке

Marzban `v0.8.4` копирует inbound до того, как подставит в него `sid`
(`app/subscription/share.py`: `host_inbound = inbound.copy()` в строке 267
предшествует `inbound["sid"] = random.choice(sids)` в строке 276). Ссылка
строится из копии, поэтому `sid` в неё не попадает. Мутируемый словарь при этом
общий для процесса, так что значение сохраняется между запросами:

- первая генерация ссылок после каждого старта Marzban отдаёт `sid=` пустым;
- все последующие отдают правильный short ID.

Клиент, забравший подписку в это окно, не проходит аутентификацию: REALITY
отдаёт его на маскировочный сайт, и подключение выглядит как «сервер работает,
клиент показывает N/A». Следующий редеплой перезапускает Marzban и взводит
ловушку заново.

Поэтому inbound принимает оба варианта: `bootstrap.py` рендерит
`shortIds` как `["", "<сгенерированный>"]`. Патчить закреплённый по digest
образ не требуется, а стойкость REALITY это не меняет — она держится на ключе
X25519, short ID лишь различает группы клиентов.

Проверить, что именно получает клиент, можно шагом `user_links` в
`scripts/vpn-diagnose.mjs`: в выданной ссылке параметр `sid` не должен быть
пустым при непустом `shortIds` в конфиге.

### Отклонённое рукопожатие REALITY

В логе ядра это выглядит так:

```text
[Info] transport/internet/tcp: REALITY: processed invalid connection
```

Строка одинаковая и для клиента с неверным short ID, и для клиента, чей
ClientHello сборка не умеет разобрать. Различить их можно только штатным
режимом `show`:

```bash
REALITY_SHOW=true docker compose --env-file deployment/production.env -f deployment/compose.production.yaml up -d --force-recreate bootstrap marzban
```

После этого REALITY печатает разбор каждого рукопожатия в лог ядра
(`scripts/xray-core-logs.mjs`). По завершении разбора значение возвращается к
`false`: режим печатает блок на каждое соединение.

Прежде чем подозревать конфигурацию, стоит проверить её эталонным клиентом с
самого сервера — он использует те же параметры, что выдаются подписчику, и
исключает сеть, DNAT и клиентское приложение целиком. Если такой клиент
проходит, а реальный нет, дело в версии ядра, а не в настройках.

### Возраст ядра Xray

Образ Marzban `v0.8.4` собран с ядром, которое ставилось на момент сборки:

```bash
docker compose --env-file deployment/production.env -f deployment/compose.production.yaml exec -T marzban /usr/local/bin/xray version
```

Ядро версии `24.12.31` не разбирает постквантовый `key_share`
(`X25519MLKEM768`), который современные клиенты отправляют в ClientHello. Такой
клиент отбивается на аутентификации REALITY и уходит на маскировочный сайт, а
сервер при этом полностью исправен. Смена отпечатка в клиенте не помогает:
постквантовый обмен присутствует во всех пресетах современного uTLS.

Ядро обновляется без смены закреплённого образа: Marzban запускает бинарник по
пути из `XRAY_EXECUTABLE_PATH`. Обновление обязано проходить проверку контрольной
суммы и SBOM/CVE review по `tech.md`, поэтому оформляется отдельным изменением.

### Диагностика подключения клиента

Начинать нужно отсюда, а не с логов. Скрипт проходит ту же цепочку, что и
клиент, и называет первый сломанный шаг:

```bash
docker compose --env-file deployment/production.env -f deployment/compose.production.yaml exec -T --user root app node scripts/vpn-diagnose.mjs
```

Вторым аргументом можно передать `marzbanUsername` подписчика — тогда выводятся
ещё и сгенерированные ссылки с вырезанным UUID.

| Шаг                   | `fail` означает                                                            |
| --------------------- | -------------------------------------------------------------------------- |
| `marzban_admin_token` | пароли стека и Marzban разошлись; см. раздел про `marzban_admin_sync.py`   |
| `xray_core`           | Marzban работает, но Xray не запустился: порт закрыт при «здоровом» стеке  |
| `inbound_resolved`    | Marzban не принял отрендеренный config, inbound не существует              |
| `advertised_endpoint` | клиентам выдаётся не тот адрес или порт                                    |
| `dns_record`          | записи `vpn.<domain>` нет или она не резолвится                            |
| `port_reachable`      | порт закрыт firewall, не опубликован, или запись ведёт не на VPS           |
| `reality_masquerade`  | на порту отвечает не Xray; чужой issuer означает проксированную DNS-запись |
| `user_links`          | подписка выдана без конфигураций                                           |

`chain_intact` при неработающем клиенте означает, что до Xray соединение
доходит и отбивается уже на аутентификации — тогда переходить к логам ядра.

Проба идёт из контейнера `app` через hairpin NAT, поэтому отказ на
`port_reachable` стоит подтвердить снаружи VPS перед тем, как чинить firewall.

Отклонённый REALITY-хендшейк на уровне `warning` в лог не попадает, поэтому
клиент, который не может подключиться, не оставляет следов. На время разбора
уровень поднимается переменной стека:

```bash
XRAY_LOG_LEVEL=info docker compose --env-file deployment/production.env -f deployment/compose.production.yaml up -d --force-recreate bootstrap marzban
```

Смотреть при этом надо **не** в `docker compose logs marzban`. Marzban
перехватывает вывод процесса Xray во внутренний буфер и отдаёт его только через
`/api/core/logs`, поэтому в логах контейнера видно лишь сообщения самого
Marzban, а события уровня соединения — включая отклонённый REALITY-хендшейк —
туда не попадают вовсе:

```bash
docker compose --env-file deployment/production.env -f deployment/compose.production.yaml exec -T --user root app node scripts/xray-core-logs.mjs 30
```

После разбора значение возвращается к `warning`. Access-логи не включаются ни
на одном уровне: это запрещено политикой хранения данных из `tech.md`.

### Выбор REALITY target

Кроме TLS 1.3 и совпадения SAN, цель обязана согласовывать **классический
X25519**. Если сайт выбирает постквантовый гибрид (`X25519MLKEM768`),
закреплённая сборка Xray не может перехватить хендшейк: посторонние клиенты
по-прежнему получают сертификат маскировочного сайта, а аутентифицированные
отключаются во время рукопожатия. Снаружи это выглядит как полностью исправный
сервер при нулевом трафике.

`xray tls ping` такое не показывает — он проверяет только TLS 1.3 и SAN.
Измерять нужно так, предлагая гибрид и классику одновременно:

```bash
openssl s_client -connect www.nvidia.com:443 -servername www.nvidia.com -verify_hostname www.nvidia.com -tls1_3 -groups X25519MLKEM768:X25519 </dev/null 2>/dev/null | grep -E "Negotiated TLS1.3 group|New, TLSv1.3|^Verification"
```

Цель пригодна, если в выводе есть `Verification: OK` и `New, TLSv1.3`, и **нет**
строки `Negotiated TLS1.3 group: X25519MLKEM768`. `-verify_hostname` добавлен
не зря: без него SAN не проверяется, а несовпадение имени клиент отвергнет уже
после успешной аутентификации.

Измерение на 2026-08-01:

| Цель                 | Группа              | Пригодна |
| -------------------- | ------------------- | -------- |
| `www.nvidia.com`     | классический X25519 | да       |
| `yahoo.co.jp`        | классический X25519 | да       |
| `www.tesla.com`      | классический X25519 | да       |
| `www.swift.com`      | X25519MLKEM768      | нет      |
| `www.samsung.com`    | X25519MLKEM768      | нет      |
| `gateway.icloud.com` | X25519MLKEM768      | нет      |
| `dl.google.com`      | X25519MLKEM768      | нет      |
| `addons.mozilla.org` | X25519MLKEM768      | нет      |

**Измерение устаревает.** `www.swift.com` и `www.samsung.com` были записаны здесь
как пригодные и в тот же день измерялись уже как гибридные. Пока `www.swift.com`
стоял целью в production, каждый аутентифицированный клиент отключался во время
рукопожатия, а сервер оставался «зелёным» по всем проверкам. Цель обязана
перемеряться перед каждым релизом и при любой жалобе на неработающее
подключение.

Сборка ядра при этом ни при чём: клиент со старым uTLS (только X25519) проходит
через ту же цель успешно, потому что гибрид просто не предлагается. Отсюда
обманчивый вывод «сервер исправен» — проверять надо тем ClientHello, который
отправляют реальные клиенты.

Полезные проверки без секретов:

- REALITY жив, если TLS-проба на `vpn.<domain>:8443` с SNI из `serverNames`
  возвращает подлинный сертификат маскировочного сайта;
- клиент дошёл до аутентификации, если в профиле Mini App растёт израсходованный
  трафик; нулевой трафик означает, что до Xray соединение не дошло или UUID не
  принят.

## 8. Telegram webhook

Регистрация webhook — отдельная явная операция, потому что она меняет настройки
бота на стороне Telegram:

```bash
docker compose --env-file deployment/production.env -f deployment/compose.production.yaml --profile telegram run --rm telegram-webhook
```

Команда вызывает `setWebhook` для `https://app.<domain>/api/telegram/webhook` с
`secret_token` из `app.env` и `allowed_updates` `message` и `pre_checkout_query`.
Она требует уже выпущенного сертификата, поэтому выполняется после настройки
реального домена.

## 9. Backup

Ежечасный restic backup выключен по умолчанию, чтобы стек поднимался без
внешнего storage. Порядок включения:

1. Заполнить `deployment/backup.env` по `deployment/backup.env.example`.
2. Скопировать `deployment/secrets/restic_password` в хранилище вне VPS.
3. Установить `COMPOSE_PROFILES=backup` в `deployment/production.env`.
4. Перезапустить стек и выполнить процедуры из
   [backup-restore.md](backup-restore.md).

До включения backup production launch запрещён: gates `offsite_backup` и
`restore_drill` остаются открытыми.

## 10. Что остаётся ручным

`ENABLE_LIVE_OPERATIONS=false` — состояние по умолчанию. Приложение и Marzban
работают, но реальные платежи и выдача реального VPN-доступа выключены.
Включение требует закрытия всех gates из
[production-readiness.md](production-readiness.md), включая измеренный REALITY
target, offsite backup, restore drill и ревью тимлида. При
`ENABLE_LIVE_OPERATIONS=true` без закрытых gates приложение осознанно не
стартует.

Отдельно остаются ручными: покупка домена и DNS, измерение REALITY target через
`xray tls ping` с production VPS, синхронизация времени на сервере, firewall и
SSH allowlist, SBOM/CVE review образа Marzban и bundled Xray.
