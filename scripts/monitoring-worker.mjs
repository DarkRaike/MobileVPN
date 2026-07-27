const intervalMilliseconds = Number.parseInt(
  process.env.MONITORING_INTERVAL_MILLISECONDS ?? "60000",
  10,
);
const repeatMilliseconds = Number.parseInt(
  process.env.ALERT_REPEAT_MILLISECONDS ?? "1800000",
  10,
);
const monitoringSecret = process.env.MONITORING_SECRET;
const monitoringApiUrl =
  process.env.MONITORING_API_URL ?? "http://app:3000/api/internal/monitoring";
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramChatId = process.env.ALERT_TELEGRAM_CHAT_ID;

if (!monitoringSecret) {
  throw new Error("MONITORING_SECRET is required");
}

if (
  !Number.isSafeInteger(intervalMilliseconds) ||
  intervalMilliseconds < 30_000
) {
  throw new Error("MONITORING_INTERVAL_MILLISECONDS must be at least 30000");
}

if (!Number.isSafeInteger(repeatMilliseconds) || repeatMilliseconds < 300_000) {
  throw new Error("ALERT_REPEAT_MILLISECONDS must be at least 300000");
}

if (
  (telegramBotToken && !telegramChatId) ||
  (!telegramBotToken && telegramChatId)
) {
  throw new Error(
    "TELEGRAM_BOT_TOKEN and ALERT_TELEGRAM_CHAT_ID must be configured together",
  );
}

let lastFingerprint = "";
let lastNotificationAt = 0;

function log(level, fields) {
  const line = JSON.stringify({
    ...fields,
    level,
    timestamp: new Date().toISOString(),
  });

  if (level === "error") {
    console.error(line);
  } else {
    console.info(line);
  }
}

function parseSnapshot(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray(value.signals) ||
    !["critical", "ok", "warning"].includes(value.status)
  ) {
    throw new Error("MONITORING_RESPONSE_INVALID");
  }

  const signals = value.signals
    .filter(
      (signal) =>
        typeof signal === "object" &&
        signal !== null &&
        typeof signal.id === "string" &&
        ["critical", "ok", "warning"].includes(signal.status) &&
        typeof signal.value === "number",
    )
    .map((signal) => ({
      id: signal.id,
      status: signal.status,
      value: signal.value,
    }));

  if (signals.length !== value.signals.length) {
    throw new Error("MONITORING_RESPONSE_INVALID");
  }

  return { signals, status: value.status };
}

async function sendTelegramAlert(message) {
  if (!telegramBotToken || !telegramChatId) {
    log("error", { errorCode: "ALERT_CHANNEL_NOT_CONFIGURED" });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
      {
        body: JSON.stringify({
          chat_id: telegramChatId,
          disable_web_page_preview: true,
          text: message,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error("ALERT_DELIVERY_REJECTED");
    }
  } finally {
    clearTimeout(timeout);
  }
}

function formatMessage(snapshot) {
  if (snapshot.status === "ok") {
    return "Astra VPN monitoring recovered: all operational signals are OK.";
  }

  const activeSignals = snapshot.signals
    .filter((signal) => signal.status !== "ok")
    .map((signal) => `${signal.id}=${signal.value} (${signal.status})`)
    .join(", ");

  return `Astra VPN monitoring ${snapshot.status}: ${activeSignals}`.slice(
    0,
    4_000,
  );
}

async function checkMonitoring() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(monitoringApiUrl, {
      headers: { "x-monitoring-secret": monitoringSecret },
      signal: controller.signal,
    });
    const snapshot = parseSnapshot(await response.json());
    const fingerprint = JSON.stringify(snapshot);
    const now = Date.now();
    const changed = fingerprint !== lastFingerprint;
    const repeatDue =
      snapshot.status !== "ok" &&
      now - lastNotificationAt >= repeatMilliseconds;
    const recovered =
      lastFingerprint !== "" && changed && snapshot.status === "ok";
    const activeAlertChanged = changed && snapshot.status !== "ok";

    if (activeAlertChanged || recovered || repeatDue) {
      try {
        await sendTelegramAlert(formatMessage(snapshot));
        lastFingerprint = fingerprint;
        lastNotificationAt = now;
      } catch (notificationError) {
        log("error", {
          errorCode: "ALERT_DELIVERY_FAILED",
          errorType:
            notificationError instanceof Error
              ? notificationError.name
              : "UnknownError",
        });
      }
    } else if (lastFingerprint === "") {
      lastFingerprint = fingerprint;
    }

    log("info", {
      monitoringStatus: snapshot.status,
      signalCount: snapshot.signals.length,
    });
  } catch (error) {
    const snapshot = {
      signals: [
        {
          id: "monitoring_endpoint",
          status: "critical",
          value: 1,
        },
      ],
      status: "critical",
    };
    const fingerprint = JSON.stringify(snapshot);
    const now = Date.now();

    if (
      fingerprint !== lastFingerprint ||
      now - lastNotificationAt >= repeatMilliseconds
    ) {
      try {
        await sendTelegramAlert(formatMessage(snapshot));
        lastFingerprint = fingerprint;
        lastNotificationAt = now;
      } catch (notificationError) {
        log("error", {
          errorCode: "ALERT_DELIVERY_FAILED",
          errorType:
            notificationError instanceof Error
              ? notificationError.name
              : "UnknownError",
        });
      }
    }

    log("error", {
      errorCode: "MONITORING_CHECK_FAILED",
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
  } finally {
    clearTimeout(timeout);
    setTimeout(checkMonitoring, intervalMilliseconds);
  }
}

await checkMonitoring();
