# Production readiness evidence

Машиночитаемый gate находится в `contracts/stage-0.decisions.json`. Значение `true` ставится только одновременно с сохранённым доказательством в рабочей задаче или change record. Само устное подтверждение не считается evidence.

| Gate                        | Необходимое доказательство                                                    | Статус  |
| --------------------------- | ----------------------------------------------------------------------------- | ------- |
| `base_domain_dns`           | владение доменом, DNS records и проверенный HTTPS                             | pending |
| `telegram_webhook_secret`   | secret установлен через `setWebhook` и неверный заголовок отклоняется         | pending |
| `telegram_stars_live_smoke` | контролируемые invoice, pre-checkout, successful payment и refund без staging | pending |
| `bot_owner_2fa`             | двухэтапная аутентификация включена у владельца бота                          | pending |
| `terms_and_paysupport`      | работают `/terms`, `/paysupport` и согласие перед invoice                     | pending |
| `merchant_legal_status`     | выбранный и проверенный статус самозанятого, ИП или организации               | pending |
| `tax_accounting_review`     | подтверждён порядок учёта Stars, вывода вознаграждения и необходимость чеков  | pending |
| `legal_review`              | оферта, privacy/refund policy, VPN legality и retention schedule              | pending |
| `reality_target`            | измерения с production VPS, TLS 1.3 и SAN                                     | pending |
| `reality_keys`              | ключи в secret storage, rotation и recovery procedure                         | pending |
| `marzban_security_review`   | SBOM/CVE scan Marzban image и bundled Xray, принятое решение тимлида          | pending |
| `offsite_backup`            | успешный encrypted snapshot в другом provider/account/region                  | pending |
| `restore_drill`             | протокол восстановления с фактическим RPO/RTO                                 | pending |
| `telegram_client_smoke`     | `openInvoice` на актуальных Telegram iOS, Android и Desktop                   | pending |
| `team_lead_review`          | ревью payment, Marzban, security, backup и legal gates                        | pending |

До закрытия всех строк:

- реальные платежи выключены;
- production secrets не используются;
- реальный VPN-доступ не выдаётся;
- `productionReady` остаётся `false`;
- CI остаётся единственной автоматизацией GitHub Actions, без CD.

Stage 4 implementation artifacts:

- security review: `docs/operations/security-review.md`;
- backup/restore: `docs/operations/backup-restore.md`;
- monitoring: `docs/operations/monitoring.md`;
- Telegram smoke template: `docs/operations/telegram-client-smoke.md`;
- release/rollback: `docs/operations/release-checklist.md`;
- локальный automation drill:
  `docs/evidence/local-backup-restore-drill-2026-07-28.json`.

Локальный drill и автоматические E2E не меняют статусы external gates. Значения
в таблице обновляются только после реальной production-проверки и review.
