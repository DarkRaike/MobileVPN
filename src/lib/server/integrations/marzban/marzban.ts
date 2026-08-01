import { z } from "zod";

import { ApplicationError } from "../../application-error";

const tokenSchema = z.object({
  access_token: z.string().min(1).max(4_096),
  token_type: z.string().min(1).max(32),
});
const marzbanUserSchema = z
  .object({
    data_limit: z.number().int().nonnegative().nullable(),
    expire: z.number().int().nonnegative().nullable(),
    inbounds: z.record(z.string(), z.array(z.string())),
    proxies: z.record(z.string(), z.unknown()),
    status: z.enum(["active", "disabled", "expired", "limited", "on_hold"]),
    subscription_url: z.string().min(1).max(4_096),
    used_traffic: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable()
      .optional(),
    username: z.string().regex(/^[a-z0-9_]{3,32}$/u),
  })
  .passthrough();

const DEFAULT_TIMEOUT_MILLISECONDS = 8_000;
const MAXIMUM_ATTEMPTS = 3;

export interface MarzbanUser {
  dataLimit: number;
  expiresAt: Date | null;
  inbounds: Record<string, string[]>;
  status: "active" | "disabled" | "expired" | "limited" | "on_hold";
  subscriptionUrl: string;
  usedTrafficBytes: number | null;
  username: string;
}

export interface MarzbanUserInput {
  expiresAt: Date;
  username: string;
}

export interface Marzban {
  createUser(input: MarzbanUserInput): Promise<MarzbanUser>;
  getUser(username: string): Promise<MarzbanUser | null>;
  updateUser(input: MarzbanUserInput): Promise<MarzbanUser>;
}

interface MarzbanAdapterOptions {
  baseUrl: string;
  inboundTag: string;
  password: string;
  request?: typeof fetch;
  timeoutMilliseconds?: number;
  username: string;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeUser(value: unknown): MarzbanUser {
  const result = marzbanUserSchema.safeParse(value);

  if (!result.success) {
    throw new ApplicationError(
      "MARZBAN_RESPONSE_INVALID",
      "Marzban вернул некорректный ответ.",
    );
  }

  const user = result.data;

  return {
    dataLimit: user.data_limit ?? 0,
    expiresAt: user.expire ? new Date(user.expire * 1_000) : null,
    inbounds: user.inbounds,
    status: user.status,
    subscriptionUrl: user.subscription_url,
    usedTrafficBytes: user.used_traffic ?? null,
    username: user.username,
  };
}

function validateUsername(username: string): void {
  if (!/^[a-z0-9_]{3,32}$/u.test(username)) {
    throw new ApplicationError(
      "MARZBAN_USERNAME_INVALID",
      "Некорректный идентификатор VPN-пользователя.",
    );
  }
}

export class MarzbanAdapter implements Marzban {
  private accessToken: string | null = null;
  private readonly baseUrl: string;
  private readonly inboundTag: string;
  private readonly password: string;
  private readonly request: typeof fetch;
  private readonly timeoutMilliseconds: number;
  private readonly username: string;

  constructor(options: MarzbanAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.inboundTag = options.inboundTag;
    this.password = options.password;
    this.request = options.request ?? fetch;
    this.timeoutMilliseconds =
      options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS;
    this.username = options.username;
  }

  async getUser(username: string): Promise<MarzbanUser | null> {
    validateUsername(username);
    const response = await this.authenticatedRequest(
      `/api/user/${encodeURIComponent(username)}`,
      { method: "GET" },
      true,
    );

    if (response === null) {
      return null;
    }

    return normalizeUser(response);
  }

  async createUser(input: MarzbanUserInput): Promise<MarzbanUser> {
    validateUsername(input.username);
    const response = await this.authenticatedRequest(
      "/api/user",
      {
        body: JSON.stringify(this.userBody(input, true)),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
      false,
      1,
    );

    return normalizeUser(response);
  }

  async updateUser(input: MarzbanUserInput): Promise<MarzbanUser> {
    validateUsername(input.username);
    const response = await this.authenticatedRequest(
      `/api/user/${encodeURIComponent(input.username)}`,
      {
        body: JSON.stringify(this.userBody(input, false)),
        headers: { "content-type": "application/json" },
        method: "PUT",
      },
    );

    return normalizeUser(response);
  }

  private userBody(input: MarzbanUserInput, includeUsername: boolean) {
    const expiresAtSeconds = Math.floor(input.expiresAt.getTime() / 1_000);

    if (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds <= 0) {
      throw new ApplicationError(
        "MARZBAN_EXPIRY_INVALID",
        "Некорректная дата окончания VPN-доступа.",
      );
    }

    return {
      data_limit: 0,
      data_limit_reset_strategy: "no_reset",
      expire: expiresAtSeconds,
      inbounds: { vless: [this.inboundTag] },
      // Plain VLESS, no XTLS Vision. Vision splices traffic after the VLESS
      // header, and its wire format differs between the pinned Xray 24.12.31
      // and the cores current mobile clients are built on: REALITY
      // authenticates, a few hundred bytes of handshake pass, and the tunnel
      // then carries nothing. The failure looks like a healthy subscription
      // that simply does not work, and no log records it.
      proxies: { vless: {} },
      status: "active",
      ...(includeUsername ? { username: input.username } : {}),
    };
  }

  private async authenticate(): Promise<string> {
    const body = new URLSearchParams({
      password: this.password,
      username: this.username,
    });
    let response: unknown;

    try {
      response = await this.requestWithRetry(
        "/api/admin/token",
        {
          body,
          headers: { "content-type": "application/x-www-form-urlencoded" },
          method: "POST",
        },
        false,
      );
    } catch (error) {
      // Marzban rejected the administrator credentials themselves. Retrying
      // cannot help: the deployment and Marzban hold different passwords, and
      // the operator has to reconcile them.
      if (
        error instanceof ApplicationError &&
        error.code === "MARZBAN_AUTH_FAILED"
      ) {
        throw new ApplicationError(
          "MARZBAN_CREDENTIALS_REJECTED",
          "Marzban отклонил учётные данные приложения.",
        );
      }

      throw error;
    }

    const tokenResult = tokenSchema.safeParse(response);

    if (!tokenResult.success) {
      throw new ApplicationError(
        "MARZBAN_RESPONSE_INVALID",
        "Marzban вернул некорректный ответ авторизации.",
      );
    }

    const token = tokenResult.data;
    this.accessToken = token.access_token;
    return token.access_token;
  }

  private async authenticatedRequest(
    path: string,
    init: RequestInit,
    allowNotFound = false,
    maximumAttempts = MAXIMUM_ATTEMPTS,
  ): Promise<unknown | null> {
    let token = this.accessToken ?? (await this.authenticate());

    for (
      let authenticationAttempt = 0;
      authenticationAttempt < 2;
      authenticationAttempt += 1
    ) {
      try {
        return await this.requestWithRetry(
          path,
          {
            ...init,
            headers: {
              ...Object.fromEntries(new Headers(init.headers).entries()),
              authorization: `Bearer ${token}`,
            },
          },
          allowNotFound,
          maximumAttempts,
        );
      } catch (error) {
        if (
          authenticationAttempt === 0 &&
          error instanceof ApplicationError &&
          error.code === "MARZBAN_AUTH_FAILED"
        ) {
          this.accessToken = null;
          token = await this.authenticate();
          continue;
        }

        throw error;
      }
    }

    throw new ApplicationError(
      "MARZBAN_AUTH_FAILED",
      "Marzban отклонил авторизацию.",
    );
  }

  private async requestWithRetry(
    path: string,
    init: RequestInit,
    allowNotFound: boolean,
    maximumAttempts = MAXIMUM_ATTEMPTS,
  ): Promise<unknown | null> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.timeoutMilliseconds,
      );

      try {
        const response = await this.request(`${this.baseUrl}${path}`, {
          ...init,
          signal: controller.signal,
        });

        if (allowNotFound && response.status === 404) {
          return null;
        }

        if (response.status === 401 || response.status === 403) {
          throw new ApplicationError(
            "MARZBAN_AUTH_FAILED",
            "Marzban отклонил авторизацию.",
          );
        }

        if (response.status === 409) {
          throw new ApplicationError(
            "MARZBAN_CONFLICT",
            "Состояние пользователя Marzban изменилось.",
          );
        }

        if (response.status >= 400 && response.status < 500) {
          throw new ApplicationError(
            "MARZBAN_REQUEST_REJECTED",
            "Marzban отклонил запрос.",
          );
        }

        if (!response.ok) {
          throw new ApplicationError(
            "MARZBAN_UNAVAILABLE",
            "Marzban временно недоступен.",
          );
        }

        return await response.json();
      } catch (error) {
        if (
          error instanceof ApplicationError &&
          error.code !== "MARZBAN_UNAVAILABLE"
        ) {
          throw error;
        }

        lastError = error;
      } finally {
        clearTimeout(timeout);
      }

      if (attempt < maximumAttempts) {
        await delay(200 * 2 ** (attempt - 1));
      }
    }

    throw new ApplicationError(
      "MARZBAN_UNAVAILABLE",
      lastError instanceof Error
        ? "Marzban временно недоступен."
        : "Не удалось связаться с Marzban.",
    );
  }
}
