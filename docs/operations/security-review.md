# Stage 4 security review

Дата: 2026-07-28. Scope: SvelteKit app, Telegram auth/Stars webhook, Marzban
adapter, SQLite, Docker boundaries, logs, backup и release process.

## Реализованные controls

| Область           | Control                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| Production config | Fail-closed evidence gates; mock auth запрещён; secrets/paths validated |
| Browser           | CSP, HSTS в production, nosniff, no-referrer, Permissions Policy        |
| Sessions/auth     | Signed `initData`, age check, HttpOnly cookie, exact admin ID           |
| Payments          | Server price, XTR, webhook secret, charge/event uniqueness              |
| External APIs     | Telegram endpoint override только в tests; Marzban private service      |
| Requests          | Body limits, runtime validation, CSRF/origin checks, stable errors      |
| Logging           | JSON, request ID, recursive secret/Subscription URL redaction           |
| Backup            | Online Backup API, integrity/FK/SHA checks, encrypted offsite design    |
| Network           | Public only 80/443; Marzban API and workers on private network          |
| Supply chain      | Exact npm lock, pinned Caddy/Marzban/restic images, immutable app gate  |

Backup-контейнер — единственное обоснованное исключение из non-root: ему нужно
read-only читать volumes с разными UID. У него удалены все Linux capabilities,
включён `no-new-privileges`, root filesystem read-only, а запись разрешена
только в work/status volumes.

## Rate limits

Лимиты рассчитаны на один app instance и хранят bounded state в памяти.

| Boundary                | Limit    | Key                | Body limit |
| ----------------------- | -------- | ------------------ | ---------- |
| Telegram auth           | 10/min   | client IP          | 16 KiB     |
| Promo validation        | 15/min   | user + IP          | 16 KiB     |
| Purchase/invoice        | 5/min    | user + IP          | 16 KiB     |
| Support                 | 5/10 min | user + IP          | 16 KiB     |
| Admin mutations         | 60/min   | admin + IP         | 64 KiB     |
| Telegram webhook        | 120/min  | source IP          | 64 KiB     |
| Reconciliation endpoint | 12/min   | source IP + secret | empty      |
| Monitoring endpoint     | 60/min   | source IP + secret | empty      |

При горизонтальном масштабировании in-memory limiter потребуется заменить на
общий trusted store. Для одного экземпляра из ТЗ текущая реализация корректна.

## Закрытые findings

1. Production мог быть запущен с неполными deployment facts — добавлен
   fail-closed runtime gate по `contracts/stage-0.decisions.json`.
2. Отсутствовали общие headers и CSP — добавлены SvelteKit CSP nonce,
   frame-ancestors для Telegram Web, HSTS только после production HTTPS.
3. Логи могли зависеть от разрозненной обработки ошибок — введён единый
   structured logger с redaction и correlation ID.
4. Internal/webhook boundaries не имели единообразных content-type/body/rate
   ограничений — добавлены явные лимиты и constant-time secret comparison.
5. E2E требовал подмены Telegram endpoint — override ограничен `NODE_ENV=test`,
   production всегда использует официальный endpoint.
6. Устаревший Telegram client мог создать pending invoice до обнаружения
   отсутствующего API — версия ниже WebApp 6.1 теперь отклоняется до form action.
7. SQLite WAL нельзя безопасно копировать обычным `copy` — backup использует
   Online Backup API и проверяется реальным local restic restore drill.

## Открытые release blockers

- Все внешние evidence gates в `production-readiness.md` остаются pending.
- Нужен SBOM/CVE scan зафиксированного Marzban v0.8.4 и bundled Xray с решением
  тимлида.
- Нужны реальный offsite snapshot, production restore drill и client smoke на
  актуальных Telegram iOS/Android/Desktop.
- Нужны domain/DNS/HTTPS, REALITY measurements/keys, live Stars/refund smoke,
  legal/tax reviews и 2FA владельца bot.
- Установка зависимости сообщила о 3 low и 4 moderate advisories; offline cache
  не вернул их подробности. В CI добавлен online `npm audit` с блокировкой
  high/critical, а все low/moderate должны быть разобраны и приняты или
  устранены в release evidence.
- Не выполнялись внешний penetration test и проверка конфигурации host firewall.

До закрытия пунктов `productionReady=false` и
`ENABLE_LIVE_OPERATIONS=false`. Этот документ не является одобрением
production-запуска.
