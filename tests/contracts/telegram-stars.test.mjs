import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmRefundedStarsPayment,
  confirmSuccessfulStarsPayment,
  createStarsInvoicePayload,
  readJson,
  requireRecord,
  validateStarsInvoiceRequest,
  validateStarsPreCheckout,
  verifyTelegramWebhookSecret,
} from "../../scripts/contract-utils.mjs";

const invoiceRequest = requireRecord(
  await readJson("contracts/telegram-stars/create-invoice-link.request.json"),
  "createInvoiceLink request",
);
const invoiceResponse = requireRecord(
  await readJson("contracts/telegram-stars/create-invoice-link.response.json"),
  "createInvoiceLink response",
);
const preCheckoutUpdate = requireRecord(
  await readJson("contracts/telegram-stars/pre-checkout.update.json"),
  "pre-checkout update",
);
const successfulPaymentUpdate = requireRecord(
  await readJson("contracts/telegram-stars/successful-payment.update.json"),
  "successful payment update",
);
const refundRequest = requireRecord(
  await readJson("contracts/telegram-stars/refund-star-payment.request.json"),
  "refundStarPayment request",
);
const refundedPaymentUpdate = requireRecord(
  await readJson("contracts/telegram-stars/refunded-payment.update.json"),
  "refunded payment update",
);

const expectedPayment = {
  telegramUserId: 7000000012,
  invoicePayload: "v1:22222222-2222-4222-8222-222222222222",
  amountStars: 249,
};

test("createInvoiceLink fixture is a minimal one-time Stars invoice", () => {
  assert.deepEqual(validateStarsInvoiceRequest(invoiceRequest), {
    payload: expectedPayment.invoicePayload,
    amountStars: expectedPayment.amountStars,
  });
  assert.equal(invoiceRequest.provider_token, "");
  assert.equal(invoiceRequest.currency, "XTR");
  assert.equal("subscription_period" in invoiceRequest, false);
  assert.equal("need_email" in invoiceRequest, false);
  assert.equal("need_phone_number" in invoiceRequest, false);
  assert.equal("need_shipping_address" in invoiceRequest, false);
  assert.equal(invoiceResponse.ok, true);
  assert.match(String(invoiceResponse.result), /^https:\/\/t\.me\/\$/u);
});

test("invoice payload contains only a version and opaque UUID", () => {
  assert.equal(
    createStarsInvoicePayload("22222222-2222-4222-8222-222222222222"),
    expectedPayment.invoicePayload,
  );
  assert.throws(
    () => createStarsInvoicePayload("order-with-personal-data"),
    /must be a UUID/u,
  );
});

test("invalid Stars invoices fail before calling Telegram", () => {
  const mutations = [
    ["currency", "RUB"],
    ["provider_token", "provider-secret"],
    ["prices", []],
    [
      "prices",
      [
        { label: "Base", amount: 200 },
        { label: "Tax", amount: 49 },
      ],
    ],
    ["prices", [{ label: "30 дней", amount: 249.5 }]],
  ];

  for (const [field, value] of mutations) {
    const mutated = structuredClone(invoiceRequest);
    mutated[String(field)] = value;
    assert.throws(
      () => validateStarsInvoiceRequest(mutated),
      /does not match|exactly one price|positive safe integer/u,
      `Expected ${String(field)} mutation to fail`,
    );
  }
});

test("Telegram webhook secret uses an exact constant-time comparison", () => {
  const secret = "fixture_webhook_secret_2026";

  assert.equal(verifyTelegramWebhookSecret(secret, secret), true);
  assert.equal(
    verifyTelegramWebhookSecret("fixture_webhook_secret_2027", secret),
    false,
  );
  assert.equal(verifyTelegramWebhookSecret(null, secret), false);
  assert.equal(verifyTelegramWebhookSecret(secret, ""), false);
});

test("pre-checkout validates user, payload, XTR and amount", () => {
  assert.deepEqual(
    validateStarsPreCheckout(preCheckoutUpdate, expectedPayment),
    {
      updateId: 700000001,
      queryId: "fixture_pre_checkout_query_001",
    },
  );

  const queryMutations = [
    ["currency", "USD"],
    ["total_amount", 248],
    ["invoice_payload", "v1:44444444-4444-4444-8444-444444444444"],
  ];

  for (const [field, value] of queryMutations) {
    const mutated = structuredClone(preCheckoutUpdate);
    const query = requireRecord(
      mutated.pre_checkout_query,
      "mutated pre-checkout query",
    );
    query[String(field)] = value;
    assert.throws(
      () => validateStarsPreCheckout(mutated, expectedPayment),
      /does not match/u,
    );
  }

  const wrongUser = structuredClone(preCheckoutUpdate);
  const query = requireRecord(
    wrongUser.pre_checkout_query,
    "mutated pre-checkout query",
  );
  const from = requireRecord(query.from, "mutated pre-checkout user");
  from.id = 7000000013;
  assert.throws(
    () => validateStarsPreCheckout(wrongUser, expectedPayment),
    /does not match/u,
  );
});

test("only successful_payment can confirm and identify a Stars payment", () => {
  assert.deepEqual(
    confirmSuccessfulStarsPayment(successfulPaymentUpdate, expectedPayment),
    {
      updateId: 700000002,
      chargeId: "fixture_stars_charge_001",
      amountStars: 249,
    },
  );

  assert.throws(
    () => confirmSuccessfulStarsPayment(preCheckoutUpdate, expectedPayment),
    /payment message/u,
  );

  const missingCharge = structuredClone(successfulPaymentUpdate);
  const message = requireRecord(missingCharge.message, "payment message");
  const payment = requireRecord(
    message.successful_payment,
    "successful payment",
  );
  payment.telegram_payment_charge_id = "";
  assert.throws(
    () => confirmSuccessfulStarsPayment(missingCharge, expectedPayment),
    /between 1 and 512/u,
  );
});

test("successful payment rejects every business-key mismatch", () => {
  const mutations = [
    ["currency", "USD"],
    ["total_amount", 250],
    ["invoice_payload", "v1:44444444-4444-4444-8444-444444444444"],
  ];

  for (const [field, value] of mutations) {
    const mutated = structuredClone(successfulPaymentUpdate);
    const message = requireRecord(mutated.message, "payment message");
    const payment = requireRecord(
      message.successful_payment,
      "successful payment",
    );
    payment[String(field)] = value;
    assert.throws(
      () => confirmSuccessfulStarsPayment(mutated, expectedPayment),
      /does not match/u,
    );
  }
});

test("refund uses the original user and Telegram charge ID", () => {
  assert.equal(refundRequest.user_id, expectedPayment.telegramUserId);
  assert.equal(
    refundRequest.telegram_payment_charge_id,
    "fixture_stars_charge_001",
  );
  assert.deepEqual(
    confirmRefundedStarsPayment(refundedPaymentUpdate, {
      ...expectedPayment,
      chargeId: "fixture_stars_charge_001",
    }),
    {
      updateId: 700000003,
      chargeId: "fixture_stars_charge_001",
    },
  );

  const wrongCharge = structuredClone(refundedPaymentUpdate);
  const message = requireRecord(wrongCharge.message, "refund message");
  const payment = requireRecord(message.refunded_payment, "refunded payment");
  payment.telegram_payment_charge_id = "fixture_stars_charge_002";
  assert.throws(
    () =>
      confirmRefundedStarsPayment(wrongCharge, {
        ...expectedPayment,
        chargeId: "fixture_stars_charge_001",
      }),
    /does not match/u,
  );
});

test("payment fixtures contain no VPN credentials or Telegram auth data", () => {
  const serialized = JSON.stringify([
    invoiceRequest,
    preCheckoutUpdate,
    successfulPaymentUpdate,
    refundRequest,
    refundedPaymentUpdate,
  ]);

  assert.doesNotMatch(serialized, /subscription_url/iu);
  assert.doesNotMatch(serialized, /marzban/iu);
  assert.doesNotMatch(serialized, /init_data/iu);
  assert.doesNotMatch(serialized, /bot_token/iu);
});
