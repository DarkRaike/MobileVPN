import stageZeroDecisions from "../../../../contracts/stage-0.decisions.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProductionDomain(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.toLowerCase();

  return (
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(
      normalized,
    ) &&
    !normalized.endsWith(".example") &&
    !normalized.endsWith(".test") &&
    normalized !== "localhost"
  );
}

export function isProductionReadinessApproved(decisions: unknown): boolean {
  if (!isRecord(decisions) || decisions.productionReady !== true) {
    return false;
  }

  const readiness = decisions.productionReadiness;
  const domains = decisions.domains;
  const vless = decisions.vless;

  if (!isRecord(readiness) || !isRecord(domains) || !isRecord(vless)) {
    return false;
  }

  const requiredGateIds = readiness.requiredGateIds;
  const gates = readiness.gates;
  const reality = vless.reality;

  if (
    !Array.isArray(requiredGateIds) ||
    !isRecord(gates) ||
    !isRecord(reality) ||
    !isProductionDomain(domains.baseDomain)
  ) {
    return false;
  }

  if (
    typeof reality.target !== "string" ||
    reality.target.length === 0 ||
    !Array.isArray(reality.serverNames) ||
    reality.serverNames.length === 0 ||
    !reality.serverNames.every(
      (serverName) => typeof serverName === "string" && serverName.length > 0,
    )
  ) {
    return false;
  }

  return requiredGateIds.every(
    (gateId) => typeof gateId === "string" && gates[gateId] === true,
  );
}

export const productionReadinessApproved =
  isProductionReadinessApproved(stageZeroDecisions);
