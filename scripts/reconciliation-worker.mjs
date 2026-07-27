const intervalMilliseconds = Number.parseInt(
  process.env.RECONCILIATION_INTERVAL_MILLISECONDS ?? "30000",
  10,
);
const liveOperationsEnabled =
  process.env.ENABLE_LIVE_OPERATIONS?.toLowerCase() === "true";
const internalJobSecret = process.env.INTERNAL_JOB_SECRET;
const internalJobUrl =
  process.env.INTERNAL_JOB_URL ?? "http://app:5173/api/internal/jobs/reconcile";

if (liveOperationsEnabled && !internalJobSecret) {
  throw new Error("INTERNAL_JOB_SECRET is required");
}

if (
  !Number.isSafeInteger(intervalMilliseconds) ||
  intervalMilliseconds < 5_000
) {
  throw new Error("RECONCILIATION_INTERVAL_MILLISECONDS must be at least 5000");
}

async function runReconciliation() {
  if (!liveOperationsEnabled || !internalJobSecret) {
    setTimeout(runReconciliation, intervalMilliseconds);
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const response = await fetch(internalJobUrl, {
      headers: {
        "x-internal-job-secret": internalJobSecret,
      },
      method: "POST",
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(
        JSON.stringify({
          errorCode: "RECONCILIATION_REQUEST_FAILED",
          level: "error",
          status: response.status,
          timestamp: new Date().toISOString(),
        }),
      );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        errorCode: "RECONCILIATION_REQUEST_UNAVAILABLE",
        errorType: error instanceof Error ? error.name : "UnknownError",
        level: "error",
        timestamp: new Date().toISOString(),
      }),
    );
  } finally {
    clearTimeout(timeout);
    setTimeout(runReconciliation, intervalMilliseconds);
  }
}

await runReconciliation();
