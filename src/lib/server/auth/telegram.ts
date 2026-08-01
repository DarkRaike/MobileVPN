import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

// Telegram omits optional user fields on some clients and sends them empty on
// others, so an empty value is treated as absent rather than as invalid data.
function optionalUserField<Schema extends z.ZodTypeAny>(schema: Schema) {
  return z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    schema.optional(),
  );
}

const telegramUserSchema = z.object({
  first_name: z.string().trim().min(1).max(64),
  id: z
    .union([
      z.string().regex(/^\d{1,20}$/),
      z.number().int().nonnegative().safe(),
    ])
    .transform(String),
  language_code: optionalUserField(z.string().trim().min(2).max(16)),
  last_name: optionalUserField(z.string().trim().min(1).max(64)),
  photo_url: optionalUserField(z.string().url().max(2048)),
  username: optionalUserField(
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_]{1,32}$/),
  ),
});

const HASH_PATTERN = /^[a-fA-F0-9]{64}$/;
const MAX_INIT_DATA_BYTES = 8192;
const MAX_FUTURE_CLOCK_SKEW_SECONDS = 30;

export interface TelegramUser {
  firstName: string;
  id: string;
  languageCode?: string;
  lastName?: string;
  photoUrl?: string;
  username?: string;
}

export interface ValidatedTelegramInitData {
  authDate: Date;
  queryId?: string;
  user: TelegramUser;
}

export type TelegramAuthErrorCode =
  "AUTH_INIT_DATA_EXPIRED" | "AUTH_INIT_DATA_INVALID";

/** Server side detail for logs; never returned to the browser. */
export type TelegramAuthErrorReason =
  | "auth_date_future"
  | "auth_date_malformed"
  | "auth_date_stale"
  | "hash_malformed"
  | "hash_mismatch"
  | "init_data_malformed"
  | "user_malformed"
  | "user_missing";

export class TelegramAuthError extends Error {
  constructor(
    readonly code: TelegramAuthErrorCode,
    readonly reason: TelegramAuthErrorReason,
  ) {
    super(code);
    this.name = "TelegramAuthError";
  }
}

function parseUniqueParameters(initData: string): Map<string, string> {
  if (
    !initData ||
    Buffer.byteLength(initData, "utf8") > MAX_INIT_DATA_BYTES ||
    initData.includes("\0")
  ) {
    throw new TelegramAuthError(
      "AUTH_INIT_DATA_INVALID",
      "init_data_malformed",
    );
  }

  const parsed = new URLSearchParams(initData);
  const parameters = new Map<string, string>();

  for (const [key, value] of parsed) {
    if (!key || parameters.has(key)) {
      throw new TelegramAuthError(
        "AUTH_INIT_DATA_INVALID",
        "init_data_malformed",
      );
    }

    parameters.set(key, value);
  }

  return parameters;
}

function verifyHash(
  parameters: ReadonlyMap<string, string>,
  botToken: string,
): void {
  const receivedHash = parameters.get("hash");

  if (!receivedHash || !HASH_PATTERN.test(receivedHash)) {
    throw new TelegramAuthError("AUTH_INIT_DATA_INVALID", "hash_malformed");
  }

  // Only `hash` is excluded here. `signature` belongs to the Ed25519 third
  // party method and stays part of the bot token data check string, so every
  // other received field has to be included for the HMAC to match Telegram.
  // Keys are ordered by code point, not by collation: `localeCompare` ignores
  // the weight of `_`, so a future field could sort differently than Telegram
  // signed it.
  const dataCheckString = [...parameters.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const expectedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest();
  const receivedHashBuffer = Buffer.from(receivedHash, "hex");

  if (
    receivedHashBuffer.length !== expectedHash.length ||
    !timingSafeEqual(receivedHashBuffer, expectedHash)
  ) {
    throw new TelegramAuthError("AUTH_INIT_DATA_INVALID", "hash_mismatch");
  }
}

function parseAuthDate(
  value: string | undefined,
  now: Date,
  maximumAgeSeconds: number,
): Date {
  if (!value || !/^\d{1,12}$/.test(value)) {
    throw new TelegramAuthError(
      "AUTH_INIT_DATA_INVALID",
      "auth_date_malformed",
    );
  }

  const timestampSeconds = Number(value);
  const nowSeconds = Math.floor(now.getTime() / 1000);

  if (
    !Number.isSafeInteger(timestampSeconds) ||
    timestampSeconds > nowSeconds + MAX_FUTURE_CLOCK_SKEW_SECONDS
  ) {
    throw new TelegramAuthError("AUTH_INIT_DATA_INVALID", "auth_date_future");
  }

  if (nowSeconds - timestampSeconds > maximumAgeSeconds) {
    throw new TelegramAuthError("AUTH_INIT_DATA_EXPIRED", "auth_date_stale");
  }

  return new Date(timestampSeconds * 1000);
}

function parseUser(value: string | undefined): TelegramUser {
  if (!value) {
    throw new TelegramAuthError("AUTH_INIT_DATA_INVALID", "user_missing");
  }

  try {
    const parsed = telegramUserSchema.parse(JSON.parse(value));

    return {
      firstName: parsed.first_name,
      id: parsed.id,
      languageCode: parsed.language_code,
      lastName: parsed.last_name,
      photoUrl: parsed.photo_url,
      username: parsed.username,
    };
  } catch {
    throw new TelegramAuthError("AUTH_INIT_DATA_INVALID", "user_malformed");
  }
}

export function validateTelegramInitData(
  initData: string,
  botToken: string,
  maximumAgeSeconds: number,
  now = new Date(),
): ValidatedTelegramInitData {
  const parameters = parseUniqueParameters(initData);
  verifyHash(parameters, botToken);

  return {
    authDate: parseAuthDate(
      parameters.get("auth_date"),
      now,
      maximumAgeSeconds,
    ),
    queryId: parameters.get("query_id"),
    user: parseUser(parameters.get("user")),
  };
}
