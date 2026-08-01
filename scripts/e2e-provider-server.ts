import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import { z } from "zod";

const port = 4174;
const maximumBodyBytes = 64 * 1024;

const availabilitySchema = z.strictObject({
  available: z.boolean(),
});
const invoiceSchema = z
  .object({
    currency: z.string(),
    payload: z.string(),
    prices: z.array(
      z.strictObject({
        amount: z.number().int().positive(),
        label: z.string(),
      }),
    ),
  })
  .passthrough();
const marzbanInputSchema = z
  .object({
    expire: z.number().int().positive(),
    username: z.string().min(1),
  })
  .passthrough();

type Invoice = z.infer<typeof invoiceSchema>;
type MarzbanInput = z.infer<typeof marzbanInputSchema>;

interface MarzbanUser {
  data_limit: number;
  expire: number;
  inbounds: { vless: string[] };
  proxies: { vless: { flow: string } };
  status: "active";
  subscription_url: string;
  username: string;
}

const state: {
  answerPreCheckoutCalls: number;
  createUserCalls: number;
  lastInvoice: Invoice | null;
  marzbanAvailable: boolean;
  updateUserCalls: number;
  users: Map<string, MarzbanUser>;
} = {
  answerPreCheckoutCalls: 0,
  createUserCalls: 0,
  lastInvoice: null,
  marzbanAvailable: true,
  updateUserCalls: 0,
  users: new Map(),
};

function resetState(): void {
  state.answerPreCheckoutCalls = 0;
  state.createUserCalls = 0;
  state.lastInvoice = null;
  state.marzbanAvailable = true;
  state.updateUserCalls = 0;
  state.users.clear();
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;

    if (totalBytes > maximumBodyBytes) {
      throw new Error("REQUEST_TOO_LARGE");
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function marzbanUser(input: MarzbanInput): MarzbanUser {
  return {
    data_limit: 0,
    expire: input.expire,
    inbounds: { vless: ["VLESS_TCP_REALITY_V1"] },
    proxies: { vless: {} },
    status: "active",
    subscription_url: `https://sub.example.test/sub/e2e-${input.username}`,
    username: input.username,
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

  try {
    if (request.method === "GET" && url.pathname === "/healthz") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (request.method === "POST" && url.pathname === "/test/reset") {
      resetState();
      sendJson(response, 200, { ok: true });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/test/marzban-availability"
    ) {
      const body = availabilitySchema.parse(await readJson(request));
      state.marzbanAvailable = body.available;
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && url.pathname === "/test/state") {
      sendJson(response, 200, {
        answerPreCheckoutCalls: state.answerPreCheckoutCalls,
        createUserCalls: state.createUserCalls,
        lastInvoice: state.lastInvoice,
        marzbanAvailable: state.marzbanAvailable,
        updateUserCalls: state.updateUserCalls,
        userCount: state.users.size,
      });
      return;
    }

    if (url.pathname.endsWith("/createInvoiceLink")) {
      state.lastInvoice = invoiceSchema.parse(await readJson(request));
      sendJson(response, 200, {
        ok: true,
        result: "https://t.me/$astra-e2e-invoice",
      });
      return;
    }

    if (url.pathname.endsWith("/answerPreCheckoutQuery")) {
      state.answerPreCheckoutCalls += 1;
      sendJson(response, 200, { ok: true, result: true });
      return;
    }

    if (url.pathname.endsWith("/getStarTransactions")) {
      sendJson(response, 200, {
        ok: true,
        result: { transactions: [] },
      });
      return;
    }

    if (url.pathname.endsWith("/refundStarPayment")) {
      sendJson(response, 200, { ok: true, result: true });
      return;
    }

    if (url.pathname.startsWith("/api/") && !state.marzbanAvailable) {
      sendJson(response, 503, { detail: "unavailable" });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/token") {
      sendJson(response, 200, {
        access_token: "e2e-access-token",
        token_type: "bearer",
      });
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/user/")) {
      const username = decodeURIComponent(
        url.pathname.slice("/api/user/".length),
      );
      const user = state.users.get(username);
      sendJson(response, user ? 200 : 404, user ?? { detail: "not found" });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/user") {
      const input = marzbanInputSchema.parse(await readJson(request));
      const user = marzbanUser(input);
      state.users.set(input.username, user);
      state.createUserCalls += 1;
      sendJson(response, 200, user);
      return;
    }

    if (request.method === "PUT" && url.pathname.startsWith("/api/user/")) {
      const username = decodeURIComponent(
        url.pathname.slice("/api/user/".length),
      );
      const body = await readJson(request);
      const input = marzbanInputSchema.parse({
        ...(typeof body === "object" && body !== null ? body : {}),
        username,
      });
      const user = marzbanUser(input);
      state.users.set(username, user);
      state.updateUserCalls += 1;
      sendJson(response, 200, user);
      return;
    }

    sendJson(response, 404, { error: "not_found" });
  } catch (error) {
    sendJson(
      response,
      error instanceof SyntaxError || error instanceof z.ZodError ? 400 : 500,
      { error: "request_failed" },
    );
  }
});

server.listen(port, "127.0.0.1");

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
