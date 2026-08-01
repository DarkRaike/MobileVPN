// Walk the VPN delivery chain and report the first step that is broken.
//
// A failed VLESS connection leaves no trace anywhere the stack already looks:
// Marzban answers, the order is provisioned, the subscription URL is issued and
// every operational signal stays `ok` while the client shows no connection. The
// checks below follow the same path a client takes, in order, so the failing
// layer is named instead of guessed.
//
// Read-only. UUIDs, tokens and subscription URLs are redacted.
//
// Usage: node scripts/vpn-diagnose.mjs [marzbanUsername]

import { readFile } from "node:fs/promises";
import { connect as tcpConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { resolve4 } from "node:dns/promises";

const SECRETS_DIRECTORY = process.env.SECRETS_DIRECTORY ?? "/run/astra/secrets";
const SECRETS_FILE = `${SECRETS_DIRECTORY}/generated-secrets.json`;
const REALITY_CLIENT_FILE = `${SECRETS_DIRECTORY}/reality-client.json`;
const PROBE_TIMEOUT_MILLISECONDS = 5_000;

const findings = [];

function report(step, status, detail) {
  findings.push({ detail, status, step });
  console.log(JSON.stringify({ detail, status, step }));
}

function fail(message) {
  console.error(JSON.stringify({ errorCode: "VPN_DIAGNOSE_FAILED", message }));
  process.exit(1);
}

function redactLink(link) {
  // A VLESS link carries the user UUID as its userinfo; the rest is public.
  return link.replace(/^(\w+):\/\/[^@]+@/u, "$1://<uuid>@");
}

async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    fail(`Unable to read ${path}: ${error.message}`);
  }
}

async function marzbanRequest(baseUrl, path, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MILLISECONDS),
  });

  if (!response.ok) {
    throw new Error(`${path} answered ${response.status}`);
  }

  return response.json();
}

function probeTcp(host, port) {
  return new Promise((resolve) => {
    const socket = tcpConnect({ host, port });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(PROBE_TIMEOUT_MILLISECONDS);
    socket.once("connect", () => finish({ connected: true }));
    socket.once("timeout", () =>
      finish({ connected: false, reason: "timeout" }),
    );
    socket.once("error", (error) =>
      finish({ connected: false, reason: error.code ?? error.message }),
    );
  });
}

function probeTls(host, port, serverName) {
  return new Promise((resolve) => {
    const socket = tlsConnect({
      host,
      port,
      // The masquerade certificate belongs to the REALITY target, so it cannot
      // and must not validate against this host name.
      rejectUnauthorized: false,
      servername: serverName,
    });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(PROBE_TIMEOUT_MILLISECONDS);
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate();

      finish({
        issuer: certificate?.issuer?.O ?? certificate?.issuer?.CN ?? null,
        protocol: socket.getProtocol(),
        subject: certificate?.subject?.CN ?? null,
        succeeded: true,
      });
    });
    socket.once("timeout", () =>
      finish({ reason: "timeout", succeeded: false }),
    );
    socket.once("error", (error) =>
      finish({ reason: error.code ?? error.message, succeeded: false }),
    );
  });
}

const baseUrl = process.env.MARZBAN_BASE_URL;

if (!baseUrl) {
  fail("MARZBAN_BASE_URL is required");
}

const credentials = await readJsonFile(SECRETS_FILE);
const expected = await readJsonFile(REALITY_CLIENT_FILE);

// 1. Marzban API and administrator credentials.
const tokenResponse = await fetch(`${baseUrl}/api/admin/token`, {
  body: new URLSearchParams({
    password: credentials.MARZBAN_PASSWORD ?? "",
    username: credentials.MARZBAN_USERNAME ?? "",
  }),
  headers: { "content-type": "application/x-www-form-urlencoded" },
  method: "POST",
  signal: AbortSignal.timeout(PROBE_TIMEOUT_MILLISECONDS),
});

if (!tokenResponse.ok) {
  report("marzban_admin_token", "fail", { status: tokenResponse.status });
  fail("Marzban rejected the administrator credentials; nothing else can run");
}

const { access_token: token } = await tokenResponse.json();
report("marzban_admin_token", "ok", {});

// 2. The Xray process itself. Marzban answers on its own socket even when the
// core failed to start, which leaves port 8443 closed while the stack is green.
try {
  const core = await marzbanRequest(baseUrl, "/api/core", token);

  report("xray_core", core.started === true ? "ok" : "fail", {
    started: core.started,
    version: core.version,
  });
} catch (error) {
  report("xray_core", "fail", { reason: error.message });
}

// 3. The inbound Marzban resolved from the rendered config.
try {
  const inbounds = await marzbanRequest(baseUrl, "/api/inbounds", token);
  const tags = Object.values(inbounds)
    .flat()
    .map((inbound) => inbound.tag);

  report(
    "inbound_resolved",
    tags.includes(expected.inboundTag) ? "ok" : "fail",
    { expected: expected.inboundTag, resolved: tags },
  );
} catch (error) {
  report("inbound_resolved", "fail", { reason: error.message });
}

// 4. The address and port Marzban actually hands to clients.
let advertised = null;

try {
  const hosts = await marzbanRequest(baseUrl, "/api/hosts", token);
  const entries = hosts[expected.inboundTag] ?? [];

  advertised = entries[0]
    ? {
        address: entries[0].address,
        port: entries[0].port ?? expected.port,
      }
    : null;

  report(
    "advertised_endpoint",
    advertised?.address === expected.vpnHost &&
      advertised?.port === expected.port
      ? "ok"
      : "fail",
    {
      advertised,
      expected: { address: expected.vpnHost, port: expected.port },
      hostCount: entries.length,
    },
  );
} catch (error) {
  report("advertised_endpoint", "fail", { reason: error.message });
}

const endpoint = advertised ?? {
  address: expected.vpnHost,
  port: expected.port,
};

// 5. DNS for that address. The record is only load bearing since clients are
// addressed by name, so a missing or proxied record breaks every new config.
try {
  const addresses = await resolve4(endpoint.address);

  report("dns_record", addresses.length > 0 ? "ok" : "fail", {
    addresses,
    name: endpoint.address,
  });
} catch (error) {
  report("dns_record", "fail", {
    name: endpoint.address,
    reason: error.code ?? error.message,
  });
}

// 6. Reachability of the published port.
const tcp = await probeTcp(endpoint.address, endpoint.port);
report("port_reachable", tcp.connected ? "ok" : "fail", {
  ...tcp,
  endpoint: `${endpoint.address}:${endpoint.port}`,
});

// 7. The REALITY masquerade. A genuine certificate of the target proves the
// inbound is alive; anything else means something other than Xray answers.
if (tcp.connected) {
  const serverName = expected.serverNames?.[0];
  const tls = await probeTls(endpoint.address, endpoint.port, serverName);
  const masquerading = tls.succeeded && tls.subject !== null;

  report("reality_masquerade", masquerading ? "ok" : "fail", {
    ...tls,
    serverName,
  });
}

// 8. The links Marzban generates for one real subscriber.
const username = process.argv[2];

if (username) {
  try {
    const user = await marzbanRequest(
      baseUrl,
      `/api/user/${encodeURIComponent(username)}`,
      token,
    );
    const links = (user.links ?? []).map(redactLink);

    report("user_links", links.length > 0 ? "ok" : "fail", {
      inbounds: user.inbounds,
      links,
      proxies: Object.keys(user.proxies ?? {}),
      status: user.status,
    });
  } catch (error) {
    report("user_links", "fail", { reason: error.message });
  }
}

const failed = findings.filter((finding) => finding.status === "fail");

console.log(
  JSON.stringify({
    failedSteps: failed.map((finding) => finding.step),
    verdict: failed.length === 0 ? "chain_intact" : "chain_broken",
  }),
);
process.exit(failed.length === 0 ? 0 : 1);
