import { z } from "zod";

export interface SupportNotification {
  createdAt: Date;
  firstName: string;
  lastName: string | null;
  message: string;
  publicNumber: string;
  subject: string;
  telegramUserId: string;
  username: string | null;
}

export interface SupportNotificationResult {
  messageId: string;
}

export interface SupportNotifier {
  sendTicketCreated(
    notification: SupportNotification,
  ): Promise<SupportNotificationResult>;
}

const telegramResponseSchema = z
  .object({
    ok: z.literal(true),
    result: z
      .object({
        message_id: z.number().int().nonnegative(),
      })
      .passthrough(),
  })
  .passthrough();

const TELEGRAM_TIMEOUT_MS = 5_000;

export class TelegramNotificationError extends Error {
  readonly code = "TELEGRAM_NOTIFICATION_FAILED";

  constructor() {
    super("Telegram support notification failed");
    this.name = "TelegramNotificationError";
  }
}

function escapeTelegramHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function formatSupportNotification(notification: SupportNotification): {
  details: string;
  message: string;
} {
  const fullName = [notification.firstName, notification.lastName]
    .filter(Boolean)
    .join(" ");
  const username = notification.username
    ? `@${notification.username}`
    : "не указан";

  return {
    details: [
      `<b>Новое обращение ${escapeTelegramHtml(notification.publicNumber)}</b>`,
      `Telegram ID: <code>${escapeTelegramHtml(notification.telegramUserId)}</code>`,
      `Username: <code>${escapeTelegramHtml(username)}</code>`,
      `Имя: <code>${escapeTelegramHtml(fullName)}</code>`,
      `Дата UTC: <code>${escapeTelegramHtml(notification.createdAt.toISOString())}</code>`,
      "",
      "<b>Тема</b>",
      `<pre>${escapeTelegramHtml(notification.subject)}</pre>`,
    ].join("\n"),
    message: [
      `<b>Сообщение ${escapeTelegramHtml(notification.publicNumber)}</b>`,
      `<pre>${escapeTelegramHtml(notification.message)}</pre>`,
    ].join("\n"),
  };
}

export class TelegramSupportNotifier implements SupportNotifier {
  constructor(
    private readonly botToken: string,
    private readonly adminUserId: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  private async sendMessage(
    text: string,
    replyToMessageId?: number,
  ): Promise<number> {
    let response: Response;

    try {
      response = await this.fetchImplementation(
        `https://api.telegram.org/bot${this.botToken}/sendMessage`,
        {
          body: JSON.stringify({
            chat_id: this.adminUserId,
            link_preview_options: { is_disabled: true },
            parse_mode: "HTML",
            reply_parameters:
              replyToMessageId === undefined
                ? undefined
                : { message_id: replyToMessageId },
            text,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
          signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
        },
      );
    } catch {
      throw new TelegramNotificationError();
    }

    if (!response.ok) {
      throw new TelegramNotificationError();
    }

    const payload: unknown = await response.json().catch(() => null);
    const parsed = telegramResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new TelegramNotificationError();
    }

    return parsed.data.result.message_id;
  }

  async sendTicketCreated(
    notification: SupportNotification,
  ): Promise<SupportNotificationResult> {
    const formatted = formatSupportNotification(notification);
    const detailsMessageId = await this.sendMessage(formatted.details);

    await this.sendMessage(formatted.message, detailsMessageId);

    return { messageId: String(detailsMessageId) };
  }
}

export class UnavailableSupportNotifier implements SupportNotifier {
  async sendTicketCreated(): Promise<never> {
    throw new TelegramNotificationError();
  }
}
