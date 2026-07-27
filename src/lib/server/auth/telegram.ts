import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

const telegramUserSchema = z.object({
  first_name: z.string().trim().min(1).max(64),
  id: z
    .union([
      z.string().regex(/^\d{1,20}$/),
      z.number().int().nonnegative().safe(),
    ])
    .transform(String),
  language_code: z.string().trim().min(2).max(16).optional(),
  last_name: z.string().trim().min(1).max(64).optional(),
  photo_url: z.string().url().max(2048).optional(),
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]{1,32}$/)
    .optional(),
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

export class TelegramAuthError extends Error {
  constructor(readonly code: TelegramAuthErrorCode) {
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
    throw new TelegramAuthError("AUTH_INIT_DATA_INVALID");
  }

  const parsed = new URLSearchParams(initData);
  const parameters = new Map<string, string>();

  for (const [key, value] of parsed) {
    if (!key || parameters.has(key)) {
      throw new TelegramAuthError("AUTH_INIT_DATA_INVALID");
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
    throw new TelegramAuthError("AUTH_INIT_DATA_INVALID");
  }

  const dataCheckString = [...parameters.entries()]
    .filter(([key]) => key !== "hash" && key !== "signature")
    .sort(([left], [right]) => left.localeCompare(right))
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
    throw new TelegramAuthError("AUTH_INIT_DATA_INVALID");
  }
}

function parseAuthDate(
  value: string | undefined,
  now: Date,
  maximumAgeSeconds: number,
): Date {
  if (!value || !/^\d{1,12}$/.test(value)) {
    throw new TelegramAuthError("AUTH_INIT_DATA_INVALID");
  }

  const timestampSeconds = Number(value);
  const nowSeconds = Math.floor(now.getTime() / 1000);

  if (
    !Number.isSafeInteger(timestampSeconds) ||
    timestampSeconds > nowSeconds + MAX_FUTURE_CLOCK_SKEW_SECONDS
  ) {
    throw new TelegramAuthError("AUTH_INIT_DATA_INVALID");
  }

  if (nowSeconds - timestampSeconds > maximumAgeSeconds) {
    throw new TelegramAuthError("AUTH_INIT_DATA_EXPIRED");
  }

  return new Date(timestampSeconds * 1000);
}

function parseUser(value: string | undefined): TelegramUser {
  if (!value) {
    throw new TelegramAuthError("AUTH_INIT_DATA_INVALID");
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
    throw new TelegramAuthError("AUTH_INIT_DATA_INVALID");
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
