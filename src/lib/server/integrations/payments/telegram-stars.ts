import { createHash, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { ApplicationError } from "../../application-error";

const invoiceUrlSchema = z.string().url().max(2_048);
const telegramBooleanSchema = z.literal(true);
const transactionSchema = z
  .object({
    amount: z.number().int().positive(),
    date: z.number().int().nonnegative(),
    id: z.string().min(1).max(512),
    source: z
      .object({
        invoice_payload: z.string().min(1).max(128).optional(),
        user: z
          .object({
            id: z.number().int().safe(),
          })
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
const transactionsSchema = z.object({
  transactions: z.array(transactionSchema).max(100),
});
const telegramResponseSchema = z
  .object({
    description: z.string().optional(),
    ok: z.boolean(),
    result: z.unknown().optional(),
  })
  .passthrough();

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DEFAULT_TIMEOUT_MILLISECONDS = 8_000;
const DEFAULT_MAX_ATTEMPTS = 3;

export interface CreateStarsInvoiceInput {
  amountStars: number;
  description: string;
  label: string;
  paymentAttemptId: string;
  title: string;
}

export interface AnswerPreCheckoutInput {
  errorMessage?: string;
  ok: boolean;
  queryId: string;
}

export interface RefundStarsPaymentInput {
  telegramPaymentChargeId: string;
  telegramUserId: string;
}

export interface GetStarTransactionsInput {
  limit?: number;
  offset?: number;
}

export interface StarTransaction {
  amountStars: number;
  date: Date;
  id: string;
  invoicePayload: string | null;
  telegramUserId: string | null;
}

export interface StarTransactionPage {
  nextOffset: number | null;
  transactions: StarTransaction[];
}

export interface TelegramStarsPayments {
  answerPreCheckout(input: AnswerPreCheckoutInput): Promise<void>;
  createInvoiceLink(input: CreateStarsInvoiceInput): Promise<string>;
  getTransactions(
    input: GetStarTransactionsInput,
  ): Promise<StarTransactionPage>;
  refundPayment(input: RefundStarsPaymentInput): Promise<void>;
}

export function createStarsInvoicePayload(paymentAttemptId: string): string {
  if (!UUID_PATTERN.test(paymentAttemptId)) {
    throw new ApplicationError(
      "PAYMENT_ATTEMPT_ID_INVALID",
      "Не удалось создать платёж.",
    );
  }

  const payload = `v1:${paymentAttemptId}`;

  if (Buffer.byteLength(payload, "utf8") > 128) {
    throw new ApplicationError(
      "PAYMENT_PAYLOAD_INVALID",
      "Не удалось создать платёж.",
    );
  }

  return payload;
}

export function verifyTelegramWebhookSecret(
  received: string | null,
  expected: string,
): boolean {
  if (!received || !expected) {
    return false;
  }

  const receivedDigest = createHash("sha256").update(received).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();

  return timingSafeEqual(receivedDigest, expectedDigest);
}

function assertPositiveStars(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ApplicationError(
      "PAYMENT_AMOUNT_INVALID",
      "Некорректная сумма платежа.",
    );
  }
}

function safeText(value: string, maximumLength: number): string {
  return value.trim().slice(0, maximumLength);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class TelegramStarsAdapter implements TelegramStarsPayments {
  constructor(
    private readonly botToken: string,
    private readonly request: typeof fetch = fetch,
    private readonly timeoutMilliseconds = DEFAULT_TIMEOUT_MILLISECONDS,
  ) {}

  async createInvoiceLink(input: CreateStarsInvoiceInput): Promise<string> {
    assertPositiveStars(input.amountStars);
    const title = safeText(input.title, 32);
    const description = safeText(input.description, 255);
    const label = safeText(input.label, 32);

    if (!title || !description || !label) {
      throw new ApplicationError(
        "PAYMENT_INVOICE_INVALID",
        "Не удалось создать платёж.",
      );
    }

    return this.call(
      "createInvoiceLink",
      {
        currency: "XTR",
        description,
        payload: createStarsInvoicePayload(input.paymentAttemptId),
        prices: [{ amount: input.amountStars, label }],
        provider_token: "",
        title,
      },
      invoiceUrlSchema,
    );
  }

  async answerPreCheckout(input: AnswerPreCheckoutInput): Promise<void> {
    await this.call(
      "answerPreCheckoutQuery",
      {
        error_message: input.ok ? undefined : input.errorMessage,
        ok: input.ok,
        pre_checkout_query_id: input.queryId,
      },
      telegramBooleanSchema,
    );
  }

  async refundPayment(input: RefundStarsPaymentInput): Promise<void> {
    if (!/^\d{1,20}$/u.test(input.telegramUserId)) {
      throw new ApplicationError(
        "PAYMENT_USER_INVALID",
        "Не удалось выполнить возврат.",
      );
    }

    if (
      !input.telegramPaymentChargeId ||
      input.telegramPaymentChargeId.length > 512
    ) {
      throw new ApplicationError(
        "PAYMENT_CHARGE_INVALID",
        "Не удалось выполнить возврат.",
      );
    }

    await this.call(
      "refundStarPayment",
      {
        telegram_payment_charge_id: input.telegramPaymentChargeId,
        user_id: input.telegramUserId,
      },
      telegramBooleanSchema,
    );
  }

  async getTransactions(
    input: GetStarTransactionsInput,
  ): Promise<StarTransactionPage> {
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 100;

    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw new ApplicationError(
        "PAYMENT_RECONCILIATION_INPUT_INVALID",
        "Некорректные параметры сверки платежей.",
      );
    }

    const result = await this.call(
      "getStarTransactions",
      { limit, offset },
      transactionsSchema,
    );
    const transactions = result.transactions.map((transaction) => ({
      amountStars: transaction.amount,
      date: new Date(transaction.date * 1_000),
      id: transaction.id,
      invoicePayload: transaction.source?.invoice_payload ?? null,
      telegramUserId: transaction.source?.user
        ? String(transaction.source.user.id)
        : null,
    }));

    return {
      nextOffset:
        transactions.length === limit ? offset + transactions.length : null,
      transactions,
    };
  }

  private async call<T>(
    method: string,
    body: Record<string, unknown>,
    resultSchema: z.ZodType<T>,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= DEFAULT_MAX_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.timeoutMilliseconds,
      );

      try {
        const response = await this.request(
          `https://api.telegram.org/bot${this.botToken}/${method}`,
          {
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
            method: "POST",
            signal: controller.signal,
          },
        );
        const parsedResponse = telegramResponseSchema.parse(
          await response.json(),
        );

        if (!response.ok || !parsedResponse.ok) {
          if (response.status < 500 && response.status !== 429) {
            throw new ApplicationError(
              "TELEGRAM_API_REJECTED",
              "Telegram отклонил операцию.",
            );
          }

          throw new ApplicationError(
            "TELEGRAM_API_UNAVAILABLE",
            "Telegram временно недоступен.",
          );
        }

        return resultSchema.parse(parsedResponse.result);
      } catch (error) {
        if (
          error instanceof ApplicationError &&
          error.code === "TELEGRAM_API_REJECTED"
        ) {
          throw error;
        }

        lastError = error;
      } finally {
        clearTimeout(timeout);
      }

      if (attempt < DEFAULT_MAX_ATTEMPTS) {
        await delay(150 * 2 ** (attempt - 1));
      }
    }

    throw new ApplicationError(
      "TELEGRAM_API_UNAVAILABLE",
      lastError instanceof Error
        ? "Telegram временно недоступен."
        : "Не удалось связаться с Telegram.",
    );
  }
}

export class UnavailableTelegramStarsAdapter implements TelegramStarsPayments {
  private unavailable(): never {
    throw new ApplicationError(
      "LIVE_OPERATIONS_DISABLED",
      "Покупки временно недоступны.",
    );
  }

  answerPreCheckout(): Promise<void> {
    return Promise.reject(this.unavailable());
  }

  createInvoiceLink(): Promise<string> {
    return Promise.reject(this.unavailable());
  }

  getTransactions(): Promise<StarTransactionPage> {
    return Promise.reject(this.unavailable());
  }

  refundPayment(): Promise<void> {
    return Promise.reject(this.unavailable());
  }
}
