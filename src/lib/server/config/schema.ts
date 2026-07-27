import { z } from "zod";

import { productionReadinessApproved } from "./production-readiness";

const PRODUCTION_DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
const TELEGRAM_API_BASE_URL = "https://api.telegram.org";

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
    BASE_DOMAIN: z.preprocess(
      emptyStringToUndefined,
      z.string().trim().toLowerCase().optional(),
    ),
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
    ENABLE_LIVE_OPERATIONS: booleanFromEnvironment.default(false),
    INTERNAL_JOB_SECRET: z.preprocess(
      emptyStringToUndefined,
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{32,256}$/)
        .optional(),
    ),
    MARZBAN_BASE_URL: z.preprocess(
      emptyStringToUndefined,
      z.string().url().optional(),
    ),
    MARZBAN_PASSWORD: z.preprocess(
      emptyStringToUndefined,
      z.string().min(1).max(256).optional(),
    ),
    MARZBAN_USERNAME: z.preprocess(
      emptyStringToUndefined,
      z.string().min(1).max(128).optional(),
    ),
    MARZBAN_VLESS_INBOUND_TAG: z.preprocess(
      emptyStringToUndefined,
      z.string().trim().min(1).max(128).default("VLESS_TCP_REALITY_V1"),
    ),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    ORIGIN: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
    SESSION_SECRET: z.string().min(32),
    SUBSCRIPTION_URL_ENCRYPTION_KEY: z.preprocess(
      emptyStringToUndefined,
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{43}$/)
        .optional(),
    ),
    TELEGRAM_ADMIN_USER_ID: z.preprocess(
      emptyStringToUndefined,
      z
        .string()
        .regex(/^\d{1,20}$/)
        .optional(),
    ),
    TELEGRAM_API_BASE_URL: z.preprocess(
      emptyStringToUndefined,
      z.string().url().default(TELEGRAM_API_BASE_URL),
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
    TELEGRAM_WEBHOOK_SECRET: z.preprocess(
      emptyStringToUndefined,
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{32,256}$/)
        .optional(),
    ),
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

    if (environment.NODE_ENV === "production") {
      const baseDomain = environment.BASE_DOMAIN;

      if (
        !baseDomain ||
        !PRODUCTION_DOMAIN_PATTERN.test(baseDomain) ||
        baseDomain.endsWith(".example") ||
        baseDomain.endsWith(".test") ||
        baseDomain === "localhost"
      ) {
        context.addIssue({
          code: "custom",
          message: "A concrete production base domain is required",
          path: ["BASE_DOMAIN"],
        });
      }

      if (environment.SESSION_SECRET.length < 43) {
        context.addIssue({
          code: "custom",
          message:
            "Production session secret must contain at least 43 characters",
          path: ["SESSION_SECRET"],
        });
      }

      if (
        environment.ORIGIN &&
        baseDomain &&
        environment.ORIGIN !== `https://app.${baseDomain}`
      ) {
        context.addIssue({
          code: "custom",
          message: "Production origin must match the application host",
          path: ["ORIGIN"],
        });
      }

      if (
        environment.DATABASE_URL === ":memory:" ||
        (!environment.DATABASE_URL.startsWith("/") &&
          !environment.DATABASE_URL.startsWith("file:/"))
      ) {
        context.addIssue({
          code: "custom",
          message: "Production database path must be absolute",
          path: ["DATABASE_URL"],
        });
      }
    }

    if (
      environment.NODE_ENV === "production" &&
      !environment.TELEGRAM_ADMIN_USER_ID
    ) {
      context.addIssue({
        code: "custom",
        message: "Telegram administrator user ID is required in production",
        path: ["TELEGRAM_ADMIN_USER_ID"],
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

    if (
      environment.NODE_ENV !== "test" &&
      environment.TELEGRAM_API_BASE_URL !== TELEGRAM_API_BASE_URL
    ) {
      context.addIssue({
        code: "custom",
        message: "Telegram API base URL can only be overridden in tests",
        path: ["TELEGRAM_API_BASE_URL"],
      });
    }

    if (
      environment.ENABLE_LIVE_OPERATIONS &&
      environment.ENABLE_DEV_MOCK_AUTH
    ) {
      context.addIssue({
        code: "custom",
        message: "Live operations cannot use development mock authentication",
        path: ["ENABLE_LIVE_OPERATIONS"],
      });
    }

    if (
      environment.NODE_ENV === "production" &&
      environment.ENABLE_LIVE_OPERATIONS &&
      !productionReadinessApproved
    ) {
      context.addIssue({
        code: "custom",
        message: "Production evidence gates are not approved",
        path: ["ENABLE_LIVE_OPERATIONS"],
      });
    }

    if (environment.ENABLE_LIVE_OPERATIONS) {
      const requiredLiveFields = [
        ["MARZBAN_BASE_URL", environment.MARZBAN_BASE_URL],
        ["MARZBAN_PASSWORD", environment.MARZBAN_PASSWORD],
        ["MARZBAN_USERNAME", environment.MARZBAN_USERNAME],
        ["INTERNAL_JOB_SECRET", environment.INTERNAL_JOB_SECRET],
        [
          "SUBSCRIPTION_URL_ENCRYPTION_KEY",
          environment.SUBSCRIPTION_URL_ENCRYPTION_KEY,
        ],
        ["TELEGRAM_BOT_TOKEN", environment.TELEGRAM_BOT_TOKEN],
        ["TELEGRAM_WEBHOOK_SECRET", environment.TELEGRAM_WEBHOOK_SECRET],
      ] as const;

      for (const [field, value] of requiredLiveFields) {
        if (!value) {
          context.addIssue({
            code: "custom",
            message: `${field} is required when live operations are enabled`,
            path: [field],
          });
        }
      }

      if (
        environment.NODE_ENV === "production" &&
        environment.MARZBAN_BASE_URL
      ) {
        const marzbanUrl = new URL(environment.MARZBAN_BASE_URL);

        if (
          marzbanUrl.protocol !== "http:" ||
          marzbanUrl.hostname !== "marzban" ||
          marzbanUrl.port !== "8000" ||
          marzbanUrl.username ||
          marzbanUrl.password
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Production Marzban API must use the private Docker service",
            path: ["MARZBAN_BASE_URL"],
          });
        }
      }
    }
  });

export interface RuntimeConfig {
  baseDomain?: string;
  databaseUrl: string;
  developmentMock: {
    enabled: boolean;
    firstName: string;
    lastName?: string;
    telegramUserId: string;
    username?: string;
  };
  isProduction: boolean;
  internalJobSecret?: string;
  liveOperationsEnabled: boolean;
  marzban?: {
    baseUrl: string;
    password: string;
    username: string;
    vlessInboundTag: string;
  };
  nodeEnvironment: "development" | "test" | "production";
  origin?: string;
  sessionSecret: string;
  subscriptionUrlEncryptionKey?: string;
  telegramAdminUserId?: string;
  telegramApiBaseUrl: string;
  telegramBotToken?: string;
  telegramInitDataMaxAgeSeconds: number;
  telegramWebhookSecret?: string;
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
  const marzban =
    value.MARZBAN_BASE_URL && value.MARZBAN_PASSWORD && value.MARZBAN_USERNAME
      ? {
          baseUrl: value.MARZBAN_BASE_URL.replace(/\/+$/u, ""),
          password: value.MARZBAN_PASSWORD,
          username: value.MARZBAN_USERNAME,
          vlessInboundTag: value.MARZBAN_VLESS_INBOUND_TAG,
        }
      : undefined;

  return {
    baseDomain: value.BASE_DOMAIN,
    databaseUrl: value.DATABASE_URL,
    developmentMock: {
      enabled: value.ENABLE_DEV_MOCK_AUTH,
      firstName: value.DEV_MOCK_FIRST_NAME,
      lastName: value.DEV_MOCK_LAST_NAME,
      telegramUserId: value.DEV_MOCK_TELEGRAM_USER_ID,
      username: value.DEV_MOCK_USERNAME,
    },
    isProduction: value.NODE_ENV === "production",
    internalJobSecret: value.INTERNAL_JOB_SECRET,
    liveOperationsEnabled: value.ENABLE_LIVE_OPERATIONS,
    marzban,
    nodeEnvironment: value.NODE_ENV,
    origin: value.ORIGIN,
    sessionSecret: value.SESSION_SECRET,
    subscriptionUrlEncryptionKey: value.SUBSCRIPTION_URL_ENCRYPTION_KEY,
    telegramAdminUserId: value.TELEGRAM_ADMIN_USER_ID,
    telegramApiBaseUrl: value.TELEGRAM_API_BASE_URL.replace(/\/+$/u, ""),
    telegramBotToken: value.TELEGRAM_BOT_TOKEN,
    telegramInitDataMaxAgeSeconds: value.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
    telegramWebhookSecret: value.TELEGRAM_WEBHOOK_SECRET,
  };
}
