// Stream the Xray core log.
//
// Marzban captures the Xray process output into an internal buffer and only
// republishes it over `/api/core/logs`, so `docker compose logs marzban` shows
// the Marzban process log and never the Xray one. Connection level events,
// including a rejected REALITY handshake, are only visible here.
//
// Usage: node scripts/xray-core-logs.mjs [seconds]

import { readFile } from "node:fs/promises";

const SECRETS_FILE = "/run/astra/secrets/generated-secrets.json";
const DEFAULT_SECONDS = 30;

function fail(message) {
  console.error(JSON.stringify({ errorCode: "XRAY_LOGS_FAILED", message }));
  process.exit(1);
}

const seconds = Number.parseInt(process.argv[2] ?? String(DEFAULT_SECONDS), 10);

if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 600) {
  fail("The duration must be between 1 and 600 seconds");
}

const baseUrl = process.env.MARZBAN_BASE_URL;

if (!baseUrl) {
  fail("MARZBAN_BASE_URL is required");
}

let credentials;

try {
  credentials = JSON.parse(await readFile(SECRETS_FILE, "utf8"));
} catch (error) {
  fail(`Unable to read ${SECRETS_FILE}: ${error.message}`);
}

const form = new URLSearchParams({
  password: credentials.MARZBAN_PASSWORD ?? "",
  username: credentials.MARZBAN_USERNAME ?? "",
});
const tokenResponse = await fetch(`${baseUrl}/api/admin/token`, {
  body: form,
  headers: { "content-type": "application/x-www-form-urlencoded" },
  method: "POST",
});

if (!tokenResponse.ok) {
  fail(
    `Marzban rejected the administrator credentials: ${tokenResponse.status}`,
  );
}

const { access_token: accessToken } = await tokenResponse.json();

if (!accessToken) {
  fail("Marzban returned no access token");
}

const socketUrl = new URL(`${baseUrl}/api/core/logs`);
socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
socketUrl.searchParams.set("interval", "0.5");
socketUrl.searchParams.set("token", accessToken);

const socket = new WebSocket(socketUrl);
const stopAt = setTimeout(() => {
  socket.close();
  process.exit(0);
}, seconds * 1_000);

socket.addEventListener("open", () => {
  console.error(`--- xray core log, ${seconds}s ---`);
});
socket.addEventListener("message", (event) => {
  process.stdout.write(String(event.data));
});
socket.addEventListener("error", () => {
  clearTimeout(stopAt);
  fail("The Marzban log socket failed");
});
socket.addEventListener("close", () => {
  clearTimeout(stopAt);
  process.exit(0);
});
