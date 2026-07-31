// Registers the Telegram webhook for the deployed Mini App. The stack runs this
// only through the opt-in `telegram` Compose profile, because it changes the
// bot configuration on Telegram side.
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const baseDomain = process.env.BASE_DOMAIN;

if (!botToken) {
  throw new Error("TELEGRAM_BOT_TOKEN is required");
}

if (!webhookSecret) {
  throw new Error("TELEGRAM_WEBHOOK_SECRET is required");
}

if (!baseDomain) {
  throw new Error("BASE_DOMAIN is required");
}

const webhookUrl = `https://app.${baseDomain}/api/telegram/webhook`;
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 15_000);

try {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/setWebhook`,
    {
      body: JSON.stringify({
        // `message` carries successful_payment and refunded_payment updates.
        allowed_updates: ["message", "pre_checkout_query"],
        max_connections: 20,
        secret_token: webhookSecret,
        url: webhookUrl,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: controller.signal,
    },
  );
  const payload = await response.json();

  if (!response.ok || payload?.ok !== true) {
    console.error(
      JSON.stringify({
        description:
          typeof payload?.description === "string" ? payload.description : null,
        errorCode: "TELEGRAM_SET_WEBHOOK_FAILED",
        level: "error",
        status: response.status,
        timestamp: new Date().toISOString(),
        webhookUrl,
      }),
    );
    process.exitCode = 1;
  } else {
    console.info(
      JSON.stringify({
        level: "info",
        message: "Telegram webhook registered",
        timestamp: new Date().toISOString(),
        webhookUrl,
      }),
    );
  }
} finally {
  clearTimeout(timeout);
}
