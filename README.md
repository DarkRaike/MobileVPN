# Astra VPN Mini App

Telegram Mini App для покупки и управления VPN-доступом. Проект строится как
модульный монолит на SvelteKit, Svelte 5, TypeScript, Tailwind CSS, Drizzle ORM
и SQLite.

## Требования

- Node.js `>=24.11.0 <25`;
- npm, поставляемый с Node.js;
- Docker Engine с Docker Compose — для контейнерной разработки.

## Локальный запуск

1. Установите зависимости:

   ```powershell
   npm ci
   ```

2. Создайте локальный файл окружения:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Сгенерируйте `SESSION_SECRET` и сохраните результат в `.env`:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

4. Выберите режим авторизации:

   - для запуска внутри Telegram задайте `TELEGRAM_BOT_TOKEN` и оставьте
     `ENABLE_DEV_MOCK_AUTH=false`;
   - только для локальной браузерной разработки задайте
     `ENABLE_DEV_MOCK_AUTH=true`.

5. Примените миграции, создайте начальные тарифы и запустите приложение:

   ```powershell
   npm run db:migrate
   npm run db:seed
   npm run dev
   ```

Приложение будет доступно по адресу `http://localhost:5173`. Локальная база
создаётся в `data/` и не отслеживается Git.

## Docker development environment

После создания `.env` и заполнения `SESSION_SECRET` запустите:

```powershell
docker compose run --rm app npm run db:seed
docker compose up --build
```

Compose автоматически применяет миграции перед запуском Vite. Исходный код
монтируется в контейнер, `node_modules` и SQLite хранятся в отдельных Docker
volumes. Healthcheck доступен по `/healthz`.

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
- просматривать журнал административных действий.

Каждая admin mutation повторно проверяет права на сервере. Изменения каталога и
статусов обращений записываются в audit log без секретов и текста тикета.

После сохранения обращения приложение отправляет администратору два связанных
Telegram-сообщения: безопасные метаданные и пользовательский текст. Если Bot API
недоступен, тикет остаётся в SQLite со статусом доставки `failed`.

Цвета синхронизируются с Telegram ThemeParams; предусмотрены fallback для
светлой/тёмной темы, отсутствующего `backdrop-filter` и reduced motion.
Платежи, VPN provisioning, история покупок, QR-код и Subscription URL относятся
к этапу 3 и в текущем интерфейсе не имитируются.

## Проверка

Полный локальный набор проверок:

```powershell
npm run check
```

Он выполняет Prettier check, ESLint, Svelte/TypeScript check, contract, unit и
integration tests, проверку миграций, production build и сборку Stage 0
contract bundle.
