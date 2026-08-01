import assert from "node:assert/strict";
import test from "node:test";

import {
  readJson,
  requireRecord,
  sha256File,
} from "../../scripts/contract-utils.mjs";

const decisions = requireRecord(
  await readJson("contracts/stage-0.decisions.json"),
  "stage 0 decisions",
);
const marzbanDecision = requireRecord(decisions.marzban, "Marzban decision");
const openapiDecision = requireRecord(
  marzbanDecision.openapi,
  "Marzban OpenAPI decision",
);
const openapi = requireRecord(
  await readJson("contracts/marzban/openapi.v0.8.4.json"),
  "Marzban OpenAPI",
);

test("Marzban image, source and OpenAPI are immutable", async () => {
  assert.equal(marzbanDecision.version, "0.8.4");
  assert.equal(
    marzbanDecision.commit,
    "7f396db3e703d71a28060bc9ce4a532ec64cb1f4",
  );
  assert.match(
    String(marzbanDecision.image),
    /^gozargah\/marzban:v0\.8\.4@sha256:[0-9a-f]{64}$/u,
  );
  assert.equal(
    await sha256File(String(openapiDecision.file)),
    openapiDecision.sha256,
  );

  const info = requireRecord(openapi.info, "OpenAPI info");
  assert.equal(info.title, "MarzbanAPI");
  assert.equal(info.version, "0.8.4");
});

test("the vendored OpenAPI exposes only the adapter methods we rely on", () => {
  const paths = requireRecord(openapi.paths, "OpenAPI paths");
  assert.equal(Object.keys(paths).length, 38);

  const expectedMethods = [
    { path: "/api/admin/token", method: "post" },
    { path: "/api/user", method: "post" },
    { path: "/api/user/{username}", method: "get" },
    { path: "/api/user/{username}", method: "put" },
  ];

  for (const { path, method } of expectedMethods) {
    const pathItem = requireRecord(paths[path], `OpenAPI path ${path}`);
    assert.ok(pathItem[method], `Missing ${method.toUpperCase()} ${path}`);
  }
});

test("Marzban authentication remains OAuth2 password plus Bearer token", () => {
  const components = requireRecord(openapi.components, "OpenAPI components");
  const schemes = requireRecord(
    components.securitySchemes,
    "OpenAPI security schemes",
  );
  const oauth = requireRecord(schemes.OAuth2PasswordBearer, "OAuth2 scheme");
  const flows = requireRecord(oauth.flows, "OAuth2 flows");
  const password = requireRecord(flows.password, "OAuth2 password flow");

  assert.equal(oauth.type, "oauth2");
  assert.equal(password.tokenUrl, "/api/admin/token");
});

test("Marzban user schemas retain provisioning fields", () => {
  const components = requireRecord(openapi.components, "OpenAPI components");
  const schemas = requireRecord(components.schemas, "OpenAPI schemas");

  for (const schemaName of ["UserCreate", "UserModify"]) {
    const schema = requireRecord(schemas[schemaName], schemaName);
    const properties = requireRecord(
      schema.properties,
      `${schemaName} properties`,
    );

    for (const field of [
      "status",
      "expire",
      "data_limit",
      "data_limit_reset_strategy",
      "inbounds",
      "proxies",
    ]) {
      assert.ok(properties[field], `${schemaName} is missing ${field}`);
    }
  }

  const response = requireRecord(schemas.UserResponse, "UserResponse");
  const responseProperties = requireRecord(
    response.properties,
    "UserResponse properties",
  );
  for (const field of [
    "username",
    "status",
    "expire",
    "data_limit",
    "inbounds",
    "proxies",
    "subscription_url",
  ]) {
    assert.ok(responseProperties[field], `UserResponse is missing ${field}`);
  }
});

test("the selected VLESS contract maps to Marzban's unlimited user model", () => {
  const vless = requireRecord(decisions.vless, "VLESS decision");

  assert.equal(vless.inboundTag, "VLESS WS");
  assert.equal(vless.port, 443);
  assert.equal(vless.transport, "websocket_over_tls");
  assert.equal(vless.security, "tls");
  assert.equal(vless.flow, "");
  assert.equal(vless.trafficLimitBytes, 0);
  assert.equal(vless.resetStrategy, "no_reset");
});
