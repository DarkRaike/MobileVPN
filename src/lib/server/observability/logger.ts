export type LogLevel = "error" | "info" | "warn";

const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|credential|init.?data|password|photo.?url|private.?key|secret|session|subscription.?url|token|webhook.?payload/iu;
const BOT_TOKEN_PATTERN = /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/gu;
const SUBSCRIPTION_URL_PATTERN = /(https?:\/\/[^\s"'<>]+\/sub\/)[^\s"'<>]+/giu;
const MAXIMUM_SANITIZE_DEPTH = 8;

function redactString(value: string): string {
  return value
    .replace(BOT_TOKEN_PATTERN, "[REDACTED_BOT_TOKEN]")
    .replace(SUBSCRIPTION_URL_PATTERN, "$1[REDACTED]");
}

function sanitizeValue(
  value: unknown,
  key: string | undefined,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) {
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (depth >= MAXIMUM_SANITIZE_DEPTH) {
    return "[TRUNCATED]";
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (seen.has(value)) {
    return "[CIRCULAR]";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, undefined, depth + 1, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeValue(entryValue, entryKey, depth + 1, seen),
    ]),
  );
}

export function sanitizeLogData(value: unknown): unknown {
  return sanitizeValue(value, undefined, 0, new WeakSet());
}

export function logEvent(level: LogLevel, fields: object): void {
  const timestamp =
    "timestamp" in fields && typeof fields.timestamp === "string"
      ? fields.timestamp
      : new Date().toISOString();
  const record = sanitizeLogData({
    ...fields,
    level,
    timestamp,
  });
  const line = JSON.stringify(record);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.info(line);
}
