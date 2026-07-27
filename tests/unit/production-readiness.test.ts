import { describe, expect, it } from "vitest";

import { isProductionReadinessApproved } from "../../src/lib/server/config/production-readiness";

function approvedDecisions(): Record<string, unknown> {
  return {
    domains: { baseDomain: "astra-vpn.ru" },
    productionReadiness: {
      gates: {
        backup: true,
        telegram: true,
      },
      requiredGateIds: ["backup", "telegram"],
    },
    productionReady: true,
    vless: {
      reality: {
        serverNames: ["www.example.org"],
        target: "www.example.org:443",
      },
    },
  };
}

describe("isProductionReadinessApproved", () => {
  it("accepts only complete evidence with concrete deployment values", () => {
    expect(isProductionReadinessApproved(approvedDecisions())).toBe(true);
  });

  it("fails closed when a gate or deployment value is missing", () => {
    const decisions = approvedDecisions();
    const readiness = decisions.productionReadiness as {
      gates: Record<string, boolean>;
    };
    readiness.gates.backup = false;

    expect(isProductionReadinessApproved(decisions)).toBe(false);

    readiness.gates.backup = true;
    (decisions.domains as { baseDomain: string }).baseDomain = "astra.example";

    expect(isProductionReadinessApproved(decisions)).toBe(false);
  });
});
