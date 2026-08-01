import { json, type RequestHandler } from "@sveltejs/kit";

import { getRuntimeConfig } from "$lib/server/config/runtime";
import { getDatabase } from "$lib/server/db/runtime";
import { collectMonitoringSnapshot } from "$lib/server/observability/monitoring";
import { constantTimeEquals } from "$lib/server/security/constant-time";
import {
  consumeRateLimit,
  resolveClientKey,
} from "$lib/server/security/rate-limit";

const MONITORING_RATE_LIMIT = 60;
const MONITORING_RATE_LIMIT_WINDOW_SECONDS = 60;

export const GET: RequestHandler = async ({ getClientAddress, request }) => {
  const config = getRuntimeConfig();

  if (
    !config.monitoringSecret ||
    !constantTimeEquals(
      request.headers.get("x-monitoring-secret"),
      config.monitoringSecret,
    )
  ) {
    return json({ ok: false }, { status: 401 });
  }

  const rateLimit = consumeRateLimit(
    `monitoring:${resolveClientKey(getClientAddress)}`,
    MONITORING_RATE_LIMIT,
    MONITORING_RATE_LIMIT_WINDOW_SECONDS,
  );

  if (!rateLimit.allowed) {
    const response = json({ ok: false }, { status: 429 });
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return response;
  }

  try {
    const { client } = await getDatabase();
    const snapshot = await collectMonitoringSnapshot(
      client,
      config.backupStatusFile,
    );

    return json(snapshot, {
      status: snapshot.status === "critical" ? 503 : 200,
    });
  } catch {
    return json(
      {
        checkedAt: new Date().toISOString(),
        signals: [
          {
            id: "database",
            status: "critical",
            threshold: 1,
            value: 1,
          },
        ],
        status: "critical",
      },
      { status: 503 },
    );
  }
};
