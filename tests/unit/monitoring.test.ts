import { describe, expect, it } from "vitest";

import {
  assessBackupStatus,
  calculateOperationalStatus,
  type OperationalSignal,
} from "../../src/lib/server/observability/monitoring";

const now = new Date("2026-07-28T10:00:00.000Z");

describe("monitoring", () => {
  it("marks a fresh successful backup as healthy", () => {
    expect(
      assessBackupStatus(
        {
          lastAttemptAt: "2026-07-28T09:50:00.000Z",
          lastSuccessAt: "2026-07-28T09:50:00.000Z",
          snapshotId: "0123456789abcdef",
          status: "success",
        },
        now,
      ),
    ).toEqual({
      id: "backup_freshness",
      status: "ok",
      threshold: 65,
      value: 10,
    });
  });

  it("fails closed for a missing or stale backup status", () => {
    expect(assessBackupStatus(null, now).status).toBe("critical");
    expect(
      assessBackupStatus(
        {
          lastAttemptAt: "2026-07-28T08:54:00.000Z",
          lastSuccessAt: "2026-07-28T08:54:00.000Z",
          status: "success",
        },
        now,
      ).status,
    ).toBe("critical");
  });

  it("reports the most severe operational signal", () => {
    const signal = (
      status: OperationalSignal["status"],
    ): OperationalSignal => ({
      id: status,
      status,
      threshold: 1,
      value: status === "ok" ? 0 : 1,
    });

    expect(calculateOperationalStatus([signal("ok")])).toBe("ok");
    expect(calculateOperationalStatus([signal("ok"), signal("warning")])).toBe(
      "warning",
    );
    expect(
      calculateOperationalStatus([signal("warning"), signal("critical")]),
    ).toBe("critical");
  });
});
