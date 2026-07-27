import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { ApplicationError } from "../application-error";

const ALGORITHM = "aes-256-gcm";
const ENCRYPTION_VERSION = "v1";
const INITIALIZATION_VECTOR_BYTES = 12;

function decodeKey(encodedKey: string): Buffer {
  const key = Buffer.from(encodedKey, "base64url");

  if (key.byteLength !== 32) {
    throw new ApplicationError(
      "SUBSCRIPTION_KEY_INVALID",
      "Некорректная конфигурация защиты подписок.",
    );
  }

  return key;
}

function assertSubscriptionUrl(value: string): void {
  if (value.length > 4_096) {
    throw new ApplicationError(
      "SUBSCRIPTION_URL_INVALID",
      "Marzban вернул некорректную ссылку подписки.",
    );
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Unsupported protocol");
    }
  } catch {
    throw new ApplicationError(
      "SUBSCRIPTION_URL_INVALID",
      "Marzban вернул некорректную ссылку подписки.",
    );
  }
}

export function encryptSubscriptionUrl(
  subscriptionUrl: string,
  encodedKey: string,
): string {
  assertSubscriptionUrl(subscriptionUrl);
  const initializationVector = randomBytes(INITIALIZATION_VECTOR_BYTES);
  const cipher = createCipheriv(
    ALGORITHM,
    decodeKey(encodedKey),
    initializationVector,
  );
  const ciphertext = Buffer.concat([
    cipher.update(subscriptionUrl, "utf8"),
    cipher.final(),
  ]);
  const authenticationTag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    initializationVector.toString("base64url"),
    authenticationTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptSubscriptionUrl(
  encryptedValue: string,
  encodedKey: string,
): string {
  const [version, encodedIv, encodedTag, encodedCiphertext, extraPart] =
    encryptedValue.split(":");

  if (
    version !== ENCRYPTION_VERSION ||
    !encodedIv ||
    !encodedTag ||
    !encodedCiphertext ||
    extraPart !== undefined
  ) {
    throw new ApplicationError(
      "SUBSCRIPTION_DATA_INVALID",
      "Не удалось прочитать ссылку подписки.",
    );
  }

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      decodeKey(encodedKey),
      Buffer.from(encodedIv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");

    assertSubscriptionUrl(plaintext);
    return plaintext;
  } catch (error) {
    if (
      error instanceof ApplicationError &&
      error.code === "SUBSCRIPTION_KEY_INVALID"
    ) {
      throw error;
    }

    throw new ApplicationError(
      "SUBSCRIPTION_DATA_INVALID",
      "Не удалось прочитать ссылку подписки.",
    );
  }
}
