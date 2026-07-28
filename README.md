# VPN Mini App

Telegram Mini App для покупки и управления VPN-доступом. Проект строится как
модульный монолит на SvelteKit, Svelte 5, TypeScript, Tailwind CSS, Drizzle ORM
и SQLite.

## Требования

- Node.js `>=24.11.0 <25`;
- npm, поставляемый с Node.js;
- Docker Engine с Docker Compose — для контейнерной разработки и operations
  drill;
- Python 3 — для локальных backup/restore regression tests.

## Локальный запуск

1. Установите зависимости:

   ```powershell
   npm ci
   ```

2. Запустите development server:

   ```powershell
   npm run dev
   ```

Приложение будет доступно по адресу `http://localhost:5173`. Команда
автоматически применяет миграции и идемпотентно создаёт начальные тарифы.

Если локальная конфигурация отсутствует, только для текущего development
процесса генерируется случайный `SESSION_SECRET` и включается mock-аутентификация.
`.env` при этом не создаётся. Production-конфигурация и live-операции этим
сценарием не затрагиваются.

Для запуска внутри Telegram создайте явную локальную конфигурацию:

1. Скопируйте пример:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Сгенерируйте `SESSION_SECRET` и сохраните результат в `.env`:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

3. Задайте `TELEGRAM_BOT_TOKEN` и оставьте
   `ENABLE_DEV_MOCK_AUTH=false`.

   ```powershell
   npm run dev
   ```

Явное `ENABLE_DEV_MOCK_AUTH=false` без `TELEGRAM_BOT_TOKEN` считается ошибкой
конфигурации. Локальная база создаётся в `data/` и не отслеживается Git.

## Docker development environment

После создания `.env` и заполнения `SESSION_SECRET` запустите:

```powershell
docker compose run --rm app npm run db:seed
docker compose up --build
```

Приложение идемпотентно применяет миграции при старте. Исходный код
монтируется в контейнер, `node_modules` и SQLite хранятся в отдельных Docker
volumes. Liveness доступен по `/healthz`, readiness — по `/readyz`.

Остановить окружение без удаления данных:

```powershell
docker compose down
```

## Авторизация

Браузер отправляет на сервер только `Telegram.WebApp.initData`. Сервер
проверяет HMAC-подпись, `auth_date`, структуру пользователя и origin запроса.
После успешной проверки создаётся случайная сессия; в SQLite сохраняется только
HMAC-хеш токена, а браузер получает `HttpOnly` cookie.

Development mock отключён по умолчанию и запрещён конфигурацией при
`NODE_ENV=production`.

## База данных

Схема находится в `src/lib/server/db/schema.ts`, версионируемые SQL-миграции —
в `drizzle/`.

```powershell
npm run db:generate
npm run db:migrate
npm run db:check
```

`db:check` дважды применяет миграции к чистой in-memory базе и проверяет foreign
keys и целостность схемы. Для файловой SQLite при подключении включаются foreign
keys, WAL, `busy_timeout=5000` и `synchronous=NORMAL`.

## Каталог, поддержка и админка

Пользовательская часть содержит три секции:

- поддержка;
- главная;
- профиль.

Между секциями можно переходить через navigation island, горизонтальный свайп,
клавиши-стрелки и URL-параметр `section`. Главная загружает активные тарифы с
сервера, профиль проверяет промокоды без резервирования скидки, поддержка
показывает опубликованные FAQ и сохраняет обращения.

`npm run db:seed` идемпотентно создаёт тарифы 7/30/90 дней с ценами 99/249/599
Stars. Повторный запуск не меняет существующие записи.

Административный раздел доступен по `/admin` только пользователю, чей
проверенный Telegram user ID совпадает с `TELEGRAM_ADMIN_USER_ID`. В нём можно:

- создавать, редактировать, деактивировать и безопасно удалять тарифы;
- управлять промокодами и их allowlist тарифов;
- создавать, редактировать, публиковать и удалять FAQ;
- фильтровать обращения и менять их статус;
- просматривать заказы, платежи и состояние provisioning;
- ставить оплаченный заказ с ошибкой в очередь на безопасный повтор;
- просматривать журнал административных действий.

Каждая admin mutation повторно проверяет права на сервере. Изменения каталога и
статусов обращений записываются в audit log без секретов и текста тикета.

После сохранения обращения приложение отправляет администратору два связанных
Telegram-сообщения: безопасные метаданные и пользовательский текст. Если Bot API
недоступен, тикет остаётся в SQLite со статусом доставки `failed`.

Цвета синхронизируются с Telegram ThemeParams; предусмотрены fallback для
светлой/тёмной темы, отсутствующего `backdrop-filter` и reduced motion.

## Платежи и VPN

Покупка выполняется одноразовым invoice Telegram Stars (`XTR`). Счёт создаётся
на сервере, а VPN-доступ выдаётся только после проверенного
`message.successful_payment`. Клиентский callback `openInvoice` используется
только для обратной связи и не меняет статус платежа или подписки.

Provisioning worker идемпотентно создаёт или продлевает пользователя Marzban,
проверяя его фактическое состояние перед изменением. После выдачи профиль
показывает историю покупок, активный срок, Subscription URL и сгенерированный
на сервере QR-код. Ссылка хранится в SQLite в зашифрованном виде и не выводится
в логи.

Реальные операции закрыты fail-closed флагом
`ENABLE_LIVE_OPERATIONS=false`. Для live-режима обязательны:

- `TELEGRAM_BOT_TOKEN` и `TELEGRAM_WEBHOOK_SECRET`;
- `MARZBAN_BASE_URL`, `MARZBAN_USERNAME`, `MARZBAN_PASSWORD`;
- `MARZBAN_VLESS_INBOUND_TAG`;
- `SUBSCRIPTION_URL_ENCRYPTION_KEY` — 32 случайных байта в base64url;
- `INTERNAL_JOB_SECRET` — отдельный случайный секрет worker endpoint.

Telegram webhook принимает updates на `POST /api/telegram/webhook`.
Периодическая обработка provisioning, Stars reconciliation и синхронизация
Marzban выполняются Compose-сервисом `worker` через защищённый внутренний
endpoint `/api/internal/jobs/reconcile`.

Включать live-режим можно только после закрытия gates из
`docs/operations/production-readiness.md`, включая `/terms`, `/paysupport`,
контролируемый Stars/refund smoke и обязательное ревью платежей и Marzban.

## Проверка

Полный локальный набор проверок:

```powershell
npm run check
```

Он выполняет Prettier check, ESLint, Svelte/TypeScript check, contract, unit и
integration/operations tests, проверку миграций, production build и сборку
Stage 0 contract bundle. Браузерный critical path запускается отдельно:

```powershell
npx playwright install chromium
npm run test:e2e
```

Production Compose, backup/restore, monitoring, Telegram smoke и release/
rollback процедуры находятся в [docs/operations](docs/operations).
