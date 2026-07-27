# Telegram client smoke-test

Gate закрывается только evidence с реальными актуальными клиентами на дату
release. Эмуляция Playwright проверяет бизнес-поток, но не заменяет этот smoke.

## Матрица

| Client           | Device/OS | Telegram version | WebApp version | Result |
| ---------------- | --------- | ---------------- | -------------- | ------ |
| Telegram iOS     |           |                  |                |        |
| Telegram Android |           |                  |                |        |
| Telegram Desktop |           |                  |                |        |
| Regular browser  |           | n/a              | n/a            |        |

Минимальная WebApp API version — 6.1. Перед release записать UTC-время, test
account, bot username, application release digest и имя проверяющего. Секреты,
`initData`, Subscription URL и payment charge ID в evidence не сохранять.

## Сценарии для каждого Telegram client

1. Открыть Mini App из menu button; проверить автоматический вход и отсутствие
   повторного запроса персональных данных.
2. Проверить dark/light theme, safe area, системный BackButton, три раздела,
   scroll, swipe и элементы минимум 44×44 px.
3. Применить контролируемый промокод; сравнить server invoice amount с UI.
4. Открыть invoice прямым нажатием; проверить cancel без изменения доступа.
5. Открыть новый invoice и выполнить контролируемую оплату.
6. Убедиться, что callback `paid` показывает ожидание, но доступ появляется
   только после серверного `successful_payment`.
7. Проверить профиль, срок, QR, copy/open link и подключение тестового клиента.
8. Повторно открыть Mini App и убедиться в сохранении server session/state.
9. Выполнить контролируемый полный refund и проверить отсутствие повторного
   возврата или повреждения срока других заказов.

На Desktop отдельно проверить изменение размера окна. На iOS/Android — смену
orientation, возврат из invoice и сетевой reconnect.

## Обычный браузер

Открыть application URL без Telegram. Ожидается диагностическое сообщение
«Это приложение доступно только внутри Telegram», invoice не создаётся, mock
auth в production отсутствует.

## Evidence

Evidence record должен содержать:

- change/release ID и image digest;
- строки матрицы с фактическими версиями;
- результат каждого шага, найденные дефекты и ссылки на задачи;
- server-side подтверждение webhook/provisioning/refund без секретных payload;
- подпись разработчика и review тимлида.

Только после полного pass изменить gate `telegram_client_smoke`; одновременно
нельзя закрывать `telegram_stars_live_smoke` без полного Stars/refund сценария.
