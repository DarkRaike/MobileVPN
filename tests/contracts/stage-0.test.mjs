import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertProductionReady,
  readJson,
  requireRecord,
} from "../../scripts/contract-utils.mjs";

const decisions = requireRecord(
  await readJson("contracts/stage-0.decisions.json"),
  "stage 0 decisions",
);

test("stage 0 decisions cover every requested external boundary", () => {
  assert.equal(decisions.stage, 0);
  assert.equal(decisions.implementationStatus, "approved_for_implementation");
  assert.equal(decisions.productionReady, true);
  // Legal texts are owner-approved placeholders; the record has to say so for
  // as long as that is true.
  assert.equal(decisions.legalContentStatus, "placeholder");

  for (const section of [
    "payments",
    "domains",
    "reverseProxy",
    "marzban",
    "vless",
    "dataRetention",
    "backup",
    "productionReadiness",
  ]) {
    assert.ok(decisions[section], `Missing stage 0 section: ${section}`);
  }
});

test("Telegram Stars is the only selected payment provider", () => {
  const payments = requireRecord(decisions.payments, "payments");
  const product = requireRecord(decisions.product, "product");

  assert.equal(payments.provider, "telegram_stars");
  assert.equal(payments.currency, "XTR");
  assert.equal(payments.flow, "one_time_mini_app_invoice");
  assert.equal(payments.recurringPayments, false);
  assert.deepEqual(payments.paymentMethods, ["telegram_stars"]);
  assert.equal(product.currency, "XTR");
  assert.deepEqual(product.plans, [
    { durationDays: 7, priceStars: 99 },
    { durationDays: 30, priceStars: 249 },
    { durationDays: 90, priceStars: 599 },
  ]);
  assert.doesNotMatch(JSON.stringify(payments), /stripe|lava|robokassa/iu);
});

test("client callback and pre-checkout cannot confirm payment", () => {
  const payments = requireRecord(decisions.payments, "payments");
  const callback = requireRecord(payments.miniAppCallback, "Mini App callback");
  const webhook = requireRecord(payments.webhook, "payment webhook");
  const confirmation = requireRecord(
    webhook.authoritativeConfirmation,
    "authoritative payment confirmation",
  );

  assert.equal(callback.confirmsPayment, false);
  assert.equal(webhook.preCheckoutApprovalConfirmsPayment, false);
  assert.equal(confirmation.source, "message.successful_payment");
  assert.deepEqual(confirmation.requiredMatches, [
    "message.from.id",
    "invoice_payload",
    "currency=XTR",
    "total_amount",
    "telegram_payment_charge_id",
  ]);
});

test("network topology exposes only the selected public entry points", () => {
  const domains = requireRecord(decisions.domains, "domains");
  const templates = requireRecord(domains.templates, "domain templates");
  const reverseProxy = requireRecord(decisions.reverseProxy, "reverse proxy");

  assert.equal(domains.baseDomain, "vpn-service.fun");
  assert.equal(templates.application, "app.{baseDomain}");
  assert.equal(templates.subscription, "sub.{baseDomain}");
  assert.equal(templates.reality, "vpn.{baseDomain}");
  assert.equal(domains.publicAdminDomain, null);
  assert.equal(domains.marzbanAdminAccess, "SSH tunnel only");
  assert.deepEqual(reverseProxy.publicPorts, [80, 443, 8443]);
  assert.equal(reverseProxy.subscriptionAccessLogs, false);
  assert.deepEqual(reverseProxy.subscriptionHostDeniedPaths, [
    "/api/*",
    "/dashboard/*",
    "/docs",
    "/openapi.json",
  ]);
});

test("backup and retention decisions are bounded and testable", () => {
  const backup = requireRecord(decisions.backup, "backup");
  const retention = requireRecord(backup.retention, "backup retention");
  const dataRetention = requireRecord(
    decisions.dataRetention,
    "data retention",
  );

  assert.equal(backup.rpoMinutes, 60);
  assert.equal(backup.rtoMinutes, 240);
  assert.equal(backup.frequency, "hourly");
  assert.equal(retention.maximumDays, 84);
  assert.equal(backup.restoreOverLiveVolume, false);
  assert.equal(dataRetention.dailyIdempotentPurge, true);
  assert.equal(dataRetention.legalHoldOverridesDeletion, true);
});

test("contract tests are hermetic and delivery has no CD or staging", () => {
  const delivery = requireRecord(decisions.delivery, "delivery");

  assert.equal(delivery.continuousIntegration, "GitHub Actions");
  assert.equal(delivery.continuousDelivery, false);
  assert.equal(delivery.stagingEnvironment, false);
  assert.equal(delivery.contractTestsUseNetwork, false);
});

test("the provided HTML remains the design source of truth", async () => {
  const design = requireRecord(decisions.design, "design");
  const html = await readFile("vpn-mini-app.html", "utf8");

  assert.equal(design.source, "vpn-mini-app.html");
  for (const token of ["#151616", "#202121", "#4d96ff", "#8b8d91"]) {
    assert.match(html.toLowerCase(), new RegExp(token, "u"));
  }
});

test("production stays fail-closed when any single gate is withdrawn", () => {
  assert.equal(assertProductionReady(decisions), true);

  const readiness = requireRecord(
    decisions.productionReadiness,
    "production readiness",
  );
  assert.ok(Array.isArray(readiness.requiredGateIds));

  for (const gateId of readiness.requiredGateIds) {
    const withdrawn = structuredClone(decisions);
    requireRecord(withdrawn.productionReadiness, "production readiness").gates[
      gateId
    ] = false;

    assert.throws(
      () => assertProductionReady(withdrawn),
      new RegExp(`Production gates are not approved: ${gateId}`, "u"),
      `Gate ${gateId} must be enforced`,
    );
  }
});

test("production approval requires every gate and concrete deployment values", () => {
  const approved = structuredClone(decisions);
  const readiness = requireRecord(
    approved.productionReadiness,
    "production readiness",
  );
  const gates = requireRecord(readiness.gates, "production gates");
  assert.ok(Array.isArray(readiness.requiredGateIds));

  for (const gateId of readiness.requiredGateIds) {
    assert.equal(typeof gateId, "string");
    gates[gateId] = true;
  }

  approved.productionReady = true;
  const domains = requireRecord(approved.domains, "domains");
  domains.baseDomain = "astra-vpn.ru";
  const vless = requireRecord(approved.vless, "VLESS");
  const reality = requireRecord(vless.reality, "REALITY");
  reality.target = "www.nvidia.com:443";
  reality.serverNames = ["www.nvidia.com"];

  assert.equal(assertProductionReady(approved), true);

  domains.baseDomain = "astra.example";
  assert.throws(
    () => assertProductionReady(approved),
    /production base domain/u,
  );
});
