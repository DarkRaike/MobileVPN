import { json } from "@sveltejs/kit";

import { getRuntimeConfig } from "$lib/server/config/runtime";
import { getDatabase } from "$lib/server/db/runtime";
import { getMarzban } from "$lib/server/integrations/marzban/runtime";
import { getTelegramStarsPayments } from "$lib/server/integrations/payments/runtime";
import { reconcileTelegramStars } from "$lib/server/modules/payments/reconciliation";
import {
  reconcileSubscriptions,
  runProvisioningBatch,
} from "$lib/server/modules/subscriptions/provisioning";
import { constantTimeEquals } from "$lib/server/security/constant-time";

import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request }) => {
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
    console.error(
      JSON.stringify({
        errorCode: "PAYMENT_RECONCILIATION_FAILED",
        errorType: error instanceof Error ? error.name : "UnknownError",
        level: "error",
        route: "/api/internal/jobs/reconcile",
        timestamp: new Date().toISOString(),
      }),
    );
  }

  try {
    subscriptionResult = await reconcileSubscriptions(
      database,
      getMarzban(config),
      config.subscriptionUrlEncryptionKey,
    );
  } catch (error) {
    errors.push("SUBSCRIPTION_RECONCILIATION_FAILED");
    console.error(
      JSON.stringify({
        errorCode: "SUBSCRIPTION_RECONCILIATION_FAILED",
        errorType: error instanceof Error ? error.name : "UnknownError",
        level: "error",
        route: "/api/internal/jobs/reconcile",
        timestamp: new Date().toISOString(),
      }),
    );
  }

  try {
    provisioningResult = await runProvisioningBatch(
      database,
      getMarzban(config),
      config.subscriptionUrlEncryptionKey,
    );
  } catch (error) {
    errors.push("PROVISIONING_BATCH_FAILED");
    console.error(
      JSON.stringify({
        errorCode: "PROVISIONING_BATCH_FAILED",
        errorType: error instanceof Error ? error.name : "UnknownError",
        level: "error",
        route: "/api/internal/jobs/reconcile",
        timestamp: new Date().toISOString(),
      }),
    );
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
