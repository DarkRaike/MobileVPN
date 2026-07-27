import { z } from "zod";

const booleanFromEnvironment = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  if (value.toLowerCase() === "true") {
    return true;
  }

  if (value.toLowerCase() === "false" || value === "") {
    return false;
  }

  return value;
}, z.boolean());

function emptyStringToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

const environmentSchema = z
  .object({
    DATABASE_URL: z.preprocess(
      emptyStringToUndefined,
      z.string().trim().min(1).default("./data/astra-vpn.sqlite"),
    ),
    DEV_MOCK_FIRST_NAME: z.preprocess(
      emptyStringToUndefined,
      z.string().trim().min(1).max(64).default("Developer"),
    ),
    DEV_MOCK_LAST_NAME: z.preprocess(
      emptyStringToUndefined,
      z.string().trim().max(64).optional(),
    ),
    DEV_MOCK_TELEGRAM_USER_ID: z.preprocess(
      emptyStringToUndefined,
      z
        .string()
        .regex(/^\d{1,20}$/)
        .default("900000001"),
    ),
    DEV_MOCK_USERNAME: z.preprocess(
      emptyStringToUndefined,
      z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_]{1,32}$/)
        .optional(),
    ),
    ENABLE_DEV_MOCK_AUTH: booleanFromEnvironment.default(false),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    ORIGIN: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
    SESSION_SECRET: z.string().min(32),
    TELEGRAM_ADMIN_USER_ID: z.preprocess(
      emptyStringToUndefined,
      z
        .string()
        .regex(/^\d{1,20}$/)
        .optional(),
    ),
    TELEGRAM_BOT_TOKEN: z.preprocess(
      emptyStringToUndefined,
      z
        .string()
        .regex(/^\d+:[A-Za-z0-9_-]{20,}$/)
        .optional(),
    ),
    TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(3600)
      .default(300),
  })
  .superRefine((environment, context) => {
    if (
      environment.NODE_ENV === "production" &&
      environment.ENABLE_DEV_MOCK_AUTH
    ) {
      context.addIssue({
        code: "custom",
        message: "Development mock authentication is forbidden in production",
        path: ["ENABLE_DEV_MOCK_AUTH"],
      });
    }

    if (!environment.ENABLE_DEV_MOCK_AUTH && !environment.TELEGRAM_BOT_TOKEN) {
      context.addIssue({
        code: "custom",
        message: "Telegram bot token is required when mock auth is disabled",
        path: ["TELEGRAM_BOT_TOKEN"],
      });
    }

    if (environment.NODE_ENV === "production" && !environment.ORIGIN) {
      context.addIssue({
        code: "custom",
        message: "Origin is required in production",
        path: ["ORIGIN"],
      });
    }

    if (
      environment.NODE_ENV === "production" &&
      environment.ORIGIN &&
      new URL(environment.ORIGIN).protocol !== "https:"
    ) {
      context.addIssue({
        code: "custom",
        message: "Production origin must use HTTPS",
        path: ["ORIGIN"],
      });
    }
  });

export interface RuntimeConfig {
  databaseUrl: string;
  developmentMock: {
    enabled: boolean;
    firstName: string;
    lastName?: string;
    telegramUserId: string;
    username?: string;
  };
  isProduction: boolean;
  nodeEnvironment: "development" | "test" | "production";
  origin?: string;
  sessionSecret: string;
  telegramAdminUserId?: string;
  telegramBotToken?: string;
  telegramInitDataMaxAgeSeconds: number;
}

export class ConfigurationError extends Error {
  readonly code = "CONFIG_INVALID";
  readonly fields: string[];

  constructor(fields: string[]) {
    super(`Invalid server configuration: ${fields.join(", ")}`);
    this.name = "ConfigurationError";
    this.fields = fields;
  }
}

export function parseRuntimeConfig(
  environment: Record<string, string | undefined>,
): RuntimeConfig {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    const fields = [
      ...new Set(
        result.error.issues.map((issue) => String(issue.path[0] ?? "unknown")),
      ),
    ].sort();
    throw new ConfigurationError(fields);
  }

  const value = result.data;

  return {
    databaseUrl: value.DATABASE_URL,
    developmentMock: {
      enabled: value.ENABLE_DEV_MOCK_AUTH,
      firstName: value.DEV_MOCK_FIRST_NAME,
      lastName: value.DEV_MOCK_LAST_NAME,
      telegramUserId: value.DEV_MOCK_TELEGRAM_USER_ID,
      username: value.DEV_MOCK_USERNAME,
    },
    isProduction: value.NODE_ENV === "production",
    nodeEnvironment: value.NODE_ENV,
    origin: value.ORIGIN,
    sessionSecret: value.SESSION_SECRET,
    telegramAdminUserId: value.TELEGRAM_ADMIN_USER_ID,
    telegramBotToken: value.TELEGRAM_BOT_TOKEN,
    telegramInitDataMaxAgeSeconds: value.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
  };
}
