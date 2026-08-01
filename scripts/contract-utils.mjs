import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

const projectRoot = new URL("../", import.meta.url);

/**
 * @param {string} relativePath
 * @returns {Promise<unknown>}
 */
export async function readJson(relativePath) {
  const raw = await readFile(new URL(relativePath, projectRoot), "utf8");
  return JSON.parse(raw);
}

/**
 * @param {string} relativePath
 * @returns {Promise<string>}
 */
export async function sha256File(relativePath) {
  const content = await readFile(new URL(relativePath, projectRoot));
  return createHash("sha256").update(content).digest("hex");
}

/**
 * @param {string | null | undefined} actual
 * @param {string} expected
 * @returns {boolean}
 */
export function verifyTelegramWebhookSecret(actual, expected) {
  if (!actual || expected.length === 0) {
    return false;
  }

  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");

  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

/**
 * @param {string} paymentAttemptId
 * @returns {string}
 */
export function createStarsInvoicePayload(paymentAttemptId) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      paymentAttemptId,
    )
  ) {
    throw new TypeError("Payment attempt ID must be a UUID");
  }

  const payload = `v1:${paymentAttemptId}`;
  if (Buffer.byteLength(payload, "utf8") > 128) {
    throw new RangeError("Telegram invoice payload exceeds 128 bytes");
  }

  return payload;
}

/**
 * @param {unknown} input
 * @returns {{ payload: string, amountStars: number }}
 */
export function validateStarsInvoiceRequest(input) {
  const invoice = requireRecord(input, "Telegram Stars invoice");
  requireBoundedString(invoice.title, "invoice title", 1, 32);
  requireBoundedString(invoice.description, "invoice description", 1, 255);
  requireBoundedString(invoice.payload, "invoice payload", 1, 128, true);
  requireEqual(invoice.provider_token, "", "provider token");
  requireEqual(invoice.currency, "XTR", "currency");

  if (!Array.isArray(invoice.prices) || invoice.prices.length !== 1) {
    throw new Error("Telegram Stars invoice must contain exactly one price");
  }

  const price = requireRecord(invoice.prices[0], "Telegram Stars price");
  requireBoundedString(price.label, "price label", 1, 255);
  requirePositiveInteger(price.amount, "Stars amount");

  return {
    payload: /** @type {string} */ (invoice.payload),
    amountStars: /** @type {number} */ (price.amount),
  };
}

/**
 * @typedef {object} ExpectedStarsPayment
 * @property {number} telegramUserId
 * @property {string} invoicePayload
 * @property {number} amountStars
 */

/**
 * @param {unknown} update
 * @param {ExpectedStarsPayment} expected
 * @returns {{ updateId: number, queryId: string }}
 */
export function validateStarsPreCheckout(update, expected) {
  const envelope = requireRecord(update, "Telegram Update");
  const query = requireRecord(
    envelope.pre_checkout_query,
    "pre-checkout query",
  );
  const from = requireRecord(query.from, "pre-checkout user");

  requirePositiveInteger(envelope.update_id, "update ID");
  requireBoundedString(query.id, "pre-checkout query ID", 1, 256);
  requireStarsPaymentFields(query, from, expected);

  return {
    updateId: /** @type {number} */ (envelope.update_id),
    queryId: /** @type {string} */ (query.id),
  };
}

/**
 * @param {unknown} update
 * @param {ExpectedStarsPayment} expected
 * @returns {{ updateId: number, chargeId: string, amountStars: number }}
 */
export function confirmSuccessfulStarsPayment(update, expected) {
  const envelope = requireRecord(update, "Telegram Update");
  const message = requireRecord(envelope.message, "payment message");
  const from = requireRecord(message.from, "payment user");
  const payment = requireRecord(
    message.successful_payment,
    "successful payment",
  );

  requirePositiveInteger(envelope.update_id, "update ID");
  requireStarsPaymentFields(payment, from, expected);
  requireBoundedString(
    payment.telegram_payment_charge_id,
    "Telegram payment charge ID",
    1,
    512,
  );

  return {
    updateId: /** @type {number} */ (envelope.update_id),
    chargeId: /** @type {string} */ (payment.telegram_payment_charge_id),
    amountStars: expected.amountStars,
  };
}

/**
 * @param {unknown} update
 * @param {{ invoicePayload: string, amountStars: number, chargeId: string }} expected
 * @returns {{ updateId: number, chargeId: string }}
 */
export function confirmRefundedStarsPayment(update, expected) {
  const envelope = requireRecord(update, "Telegram Update");
  const message = requireRecord(envelope.message, "refund message");
  const payment = requireRecord(message.refunded_payment, "refunded payment");

  requirePositiveInteger(envelope.update_id, "update ID");
  requirePositiveInteger(expected.amountStars, "expected Stars amount");
  requireEqual(
    payment.invoice_payload,
    expected.invoicePayload,
    "invoice payload",
  );
  requireEqual(payment.currency, "XTR", "currency");
  requireEqual(payment.total_amount, expected.amountStars, "Stars amount");
  requireEqual(
    payment.telegram_payment_charge_id,
    expected.chargeId,
    "payment charge ID",
  );

  return {
    updateId: /** @type {number} */ (envelope.update_id),
    chargeId: expected.chargeId,
  };
}

/**
 * @param {unknown} decisions
 * @returns {true}
 */
export function assertProductionReady(decisions) {
  const contract = requireRecord(decisions, "stage 0 decisions");
  const readiness = requireRecord(
    contract.productionReadiness,
    "production readiness",
  );
  const gates = requireRecord(readiness.gates, "production readiness gates");

  if (!Array.isArray(readiness.requiredGateIds)) {
    throw new TypeError("Production gate IDs must be an array");
  }

  const missingGates = readiness.requiredGateIds.filter(
    (gateId) => typeof gateId !== "string" || gates[gateId] !== true,
  );

  if (missingGates.length > 0) {
    throw new Error(
      `Production gates are not approved: ${missingGates.join(", ")}`,
    );
  }

  if (contract.productionReady !== true) {
    throw new Error("The productionReady flag is not enabled");
  }

  const domains = requireRecord(contract.domains, "domains");
  if (
    typeof domains.baseDomain !== "string" ||
    !isProductionDomain(domains.baseDomain)
  ) {
    throw new Error("A production base domain is required");
  }

  const vless = requireRecord(contract.vless, "VLESS");
  // The tunnel rides the application host's own certificate, so what has to be
  // fixed is the inbound it is served from, not a masquerade target.
  if (typeof vless.inboundTag !== "string" || vless.inboundTag.length === 0) {
    throw new Error("A concrete VLESS inbound tag is required");
  }

  return true;
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {Record<string, unknown>}
 */
export function requireRecord(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {Record<string, unknown>} payment
 * @param {Record<string, unknown>} from
 * @param {ExpectedStarsPayment} expected
 */
function requireStarsPaymentFields(payment, from, expected) {
  requirePositiveInteger(expected.telegramUserId, "expected Telegram user ID");
  requirePositiveInteger(expected.amountStars, "expected Stars amount");
  requireEqual(from.id, expected.telegramUserId, "Telegram user ID");
  requireEqual(
    payment.invoice_payload,
    expected.invoicePayload,
    "invoice payload",
  );
  requireEqual(payment.currency, "XTR", "currency");
  requireEqual(payment.total_amount, expected.amountStars, "Stars amount");
}

/**
 * @param {unknown} value
 * @param {string} label
 * @param {number} minimum
 * @param {number} maximum
 * @param {boolean} [measureBytes]
 */
function requireBoundedString(
  value,
  label,
  minimum,
  maximum,
  measureBytes = false,
) {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }

  const length = measureBytes
    ? Buffer.byteLength(value, "utf8")
    : Array.from(value).length;

  if (length < minimum || length > maximum) {
    throw new RangeError(
      `${label} must contain between ${minimum} and ${maximum} ${
        measureBytes ? "bytes" : "characters"
      }`,
    );
  }
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || /** @type {number} */ (value) <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} label
 */
function requireEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `Telegram Stars ${label} does not match the local payment attempt`,
    );
  }
}

/**
 * @param {string} domain
 * @returns {boolean}
 */
function isProductionDomain(domain) {
  const normalized = domain.toLowerCase();

  return (
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(
      normalized,
    ) &&
    !normalized.endsWith(".test") &&
    !normalized.endsWith(".example") &&
    normalized !== "localhost"
  );
}
