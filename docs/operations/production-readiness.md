# Production readiness evidence

Машиночитаемый gate находится в `contracts/stage-0.decisions.json`. Значение `true` ставится только одновременно с сохранённым доказательством в рабочей задаче или change record. Само устное подтверждение не считается evidence.

| Gate                        | Необходимое доказательство                                                    | Статус   |
| --------------------------- | ----------------------------------------------------------------------------- | -------- |
| `base_domain_dns`           | владение доменом, DNS records и проверенный HTTPS                             | закрыт   |
| `telegram_webhook_secret`   | secret установлен через `setWebhook` и неверный заголовок отклоняется         | закрыт   |
| `telegram_stars_live_smoke` | контролируемые invoice, pre-checkout, successful payment и refund без staging | владелец |
| `bot_owner_2fa`             | двухэтапная аутентификация включена у владельца бота                          | владелец |
| `terms_and_paysupport`      | работают `/terms`, `/paysupport` и согласие перед invoice                     | владелец |
| `merchant_legal_status`     | выбранный и проверенный статус самозанятого, ИП или организации               | владелец |
| `tax_accounting_review`     | подтверждён порядок учёта Stars, вывода вознаграждения и необходимость чеков  | владелец |
| `legal_review`              | оферта, privacy/refund policy, VPN legality и retention schedule              | владелец |
| `reality_target`            | измерения с production VPS, TLS 1.3 и SAN                                     | закрыт   |
| `reality_keys`              | ключи в secret storage, rotation и recovery procedure                         | закрыт   |
| `marzban_security_review`   | SBOM/CVE scan Marzban image и bundled Xray, принятое решение тимлида          | закрыт   |
| `offsite_backup`            | успешный encrypted snapshot в другом provider/account/region                  | владелец |
| `restore_drill`             | протокол восстановления с фактическим RPO/RTO                                 | владелец |
| `telegram_client_smoke`     | `openInvoice` на актуальных Telegram iOS, Android и Desktop                   | закрыт   |
| `team_lead_review`          | ревью payment, Marzban, security, backup и legal gates                        | владелец |

`productionReady` установлен в `true` решением владельца, поэтому
`ENABLE_LIVE_OPERATIONS=true` разрешён и реальные платежи включаются.

Строки со статусом «владелец» закрыты его решением, а не проверенным
доказательством. `/terms` и `/paysupport` работают, но их тексты —
предварительные заглушки; это зафиксировано полем `legalContentStatus`
в `contracts/stage-0.decisions.json`.

До реальной проверки остаются открытыми: юридический и налоговый статус,
оферта и refund policy, 2FA владельца бота, контролируемый Stars smoke с
возвратом, offsite backup и restore drill. Их нужно закрыть фактически —
запись в контракте не заменяет проверку.

Stage 4 implementation artifacts:

- security review: `docs/operations/security-review.md`;
- backup/restore: `docs/operations/backup-restore.md`;
- monitoring: `docs/operations/monitoring.md`;
- Telegram smoke template: `docs/operations/telegram-client-smoke.md`;
- release/rollback: `docs/operations/release-checklist.md`;
- развёртывание на VPS: `docs/operations/vps-deployment.md`;
- локальный automation drill:
  `docs/evidence/local-backup-restore-drill-2026-07-28.json`.

Локальный drill и автоматические E2E не меняют статусы external gates. Значения
в таблице обновляются только после реальной production-проверки и review.
