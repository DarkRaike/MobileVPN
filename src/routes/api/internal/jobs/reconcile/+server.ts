import { json } from "@sveltejs/kit";

import { getRuntimeConfig } from "$lib/server/config/runtime";
import { getDatabase } from "$lib/server/db/runtime";
import { getMarzban } from "$lib/server/integrations/marzban/runtime";
import { getTelegramStarsPayments } from "$lib/server/integrations/payments/runtime";
import { logEvent } from "$lib/server/observability/logger";
import { reconcileTelegramStars } from "$lib/server/modules/payments/reconciliation";
import {
  reconcileSubscriptions,
  runProvisioningBatch,
} from "$lib/server/modules/subscriptions/provisioning";
import { constantTimeEquals } from "$lib/server/security/constant-time";
import {
  consumeRateLimit,
  resolveInternalClientKey,
} from "$lib/server/security/rate-limit";

import type { RequestHandler } from "./$types";

const JOB_RATE_LIMIT = 12;
const JOB_RATE_LIMIT_WINDOW_SECONDS = 60;

export const POST: RequestHandler = async ({ getClientAddress, request }) => {
  const config = getRuntimeConfig();

  if (
    !config.liveOperationsEnabled ||
    !config.internalJobSecret ||
    !config.subscriptionUrlEncryptionKey
  ) {
    return json({ ok: false }, { status: 503 });
  }

  if (
    !constantTimeEquals(
      request.headers.get("x-internal-job-secret"),
      config.internalJobSecret,
    )
  ) {
    return json({ ok: false }, { status: 401 });
  }

  const rateLimit = consumeRateLimit(
    `reconciliation-job:${resolveInternalClientKey(getClientAddress)}`,
    JOB_RATE_LIMIT,
    JOB_RATE_LIMIT_WINDOW_SECONDS,
  );

  if (!rateLimit.allowed) {
    const response = json({ ok: false }, { status: 429 });
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return response;
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");

  if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
    return json({ ok: false }, { status: 400 });
  }

  if (contentLength > 0) {
    return json({ ok: false }, { status: 413 });
  }

  const { database } = await getDatabase();
  const errors: string[] = [];
  let paymentResult = { confirmed: 0, inspected: 0 };
  let provisioningResult: Awaited<ReturnType<typeof runProvisioningBatch>> = [];
  let subscriptionResult = { failed: 0, inspected: 0, synchronized: 0 };

  try {
    paymentResult = await reconcileTelegramStars(
      database,
      getTelegramStarsPayments(config),
    );
  } catch (error) {
    errors.push("PAYMENT_RECONCILIATION_FAILED");
    logEvent("error", {
      errorCode: "PAYMENT_RECONCILIATION_FAILED",
      errorType: error instanceof Error ? error.name : "UnknownError",
      route: "/api/internal/jobs/reconcile",
    });
  }

  try {
    subscriptionResult = await reconcileSubscriptions(
      database,
      getMarzban(config),
      config.subscriptionUrlEncryptionKey,
    );
  } catch (error) {
    errors.push("SUBSCRIPTION_RECONCILIATION_FAILED");
    logEvent("error", {
      errorCode: "SUBSCRIPTION_RECONCILIATION_FAILED",
      errorType: error instanceof Error ? error.name : "UnknownError",
      route: "/api/internal/jobs/reconcile",
    });
  }

  try {
    provisioningResult = await runProvisioningBatch(
      database,
      getMarzban(config),
      config.subscriptionUrlEncryptionKey,
    );
  } catch (error) {
    errors.push("PROVISIONING_BATCH_FAILED");
    logEvent("error", {
      errorCode: "PROVISIONING_BATCH_FAILED",
      errorType: error instanceof Error ? error.name : "UnknownError",
      route: "/api/internal/jobs/reconcile",
    });
  }

  return json(
    {
      ok: errors.length === 0,
      payments: paymentResult,
      provisioning: {
        applied: provisioningResult.filter(
          (result) => result.status === "applied",
        ).length,
        failed: provisioningResult.filter(
          (result) => result.status === "failed",
        ).length,
        inspected: provisioningResult.length,
      },
      subscriptions: subscriptionResult,
    },
    { status: errors.length === 0 ? 200 : 500 },
  );
};
