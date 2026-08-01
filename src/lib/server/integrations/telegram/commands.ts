import { z } from "zod";

const TELEGRAM_TIMEOUT_MILLISECONDS = 8_000;

const commandUpdateSchema = z.object({
  message: z.object({
    chat: z.object({ id: z.union([z.number().int().safe(), z.string()]) }),
    text: z.string().min(1).max(4_096),
  }),
});

export type BotCommand = "help" | "paysupport" | "start" | "terms";

export interface BotCommandRequest {
  chatId: string;
  command: BotCommand;
}

const supportedCommands = new Map<string, BotCommand>([
  ["/help", "help"],
  ["/paysupport", "paysupport"],
  ["/start", "start"],
  ["/terms", "terms"],
]);

/**
 * Recognises a bot command update. Telegram appends `@botname` in groups and
 * may add arguments, so only the leading token is inspected.
 */
export function parseBotCommand(value: unknown): BotCommandRequest | null {
  const result = commandUpdateSchema.safeParse(value);

  if (!result.success) {
    return null;
  }

  const { chat, text } = result.data.message;
  const firstToken = text.trim().split(/\s+/u)[0] ?? "";
  const command = supportedCommands.get(
    firstToken.split("@")[0]?.toLowerCase() ?? "",
  );

  return command ? { chatId: String(chat.id), command } : null;
}

export function buildBotCommandReply(
  command: BotCommand,
  baseDomain: string,
): string {
  const applicationUrl = `https://app.${baseDomain}`;

  switch (command) {
    case "terms":
      return [
        "<b>Условия использования</b>",
        "",
        "Сервис предоставляет доступ к VPN на выбранный срок. Оплата разовая, в Telegram Stars, автопродление не используется.",
        "",
        `Полный текст: ${applicationUrl}/terms`,
      ].join("\n");
    case "paysupport":
      return [
        "<b>Поддержка по оплате</b>",
        "",
        "Если оплата прошла, а доступ не появился, откройте приложение — статус выдачи виден в профиле. Обычно доступ создаётся в течение минуты.",
        "",
        "Возврат выполняется полностью и только по неиспользованному доступу.",
        "",
        `Обращение можно оставить в разделе поддержки: ${applicationUrl}/paysupport`,
      ].join("\n");
    default:
      return [
        "<b>VPN</b>",
        "",
        "Откройте приложение кнопкой меню, чтобы выбрать тариф и получить ссылку подключения.",
        "",
        "/terms — условия использования",
        "/paysupport — вопросы по оплате",
      ].join("\n");
  }
}

export async function sendBotCommandReply(
  botToken: string,
  request: BotCommandRequest,
  baseDomain: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<void> {
  await fetchImplementation(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      body: JSON.stringify({
        chat_id: request.chatId,
        link_preview_options: { is_disabled: true },
        parse_mode: "HTML",
        text: buildBotCommandReply(request.command, baseDomain),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MILLISECONDS),
    },
  );
}
