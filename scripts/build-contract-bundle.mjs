import { mkdir, readFile, writeFile } from "node:fs/promises";

import {
  assertProductionReady,
  readJson,
  requireRecord,
  sha256File,
} from "./contract-utils.mjs";

const projectRoot = new URL("../", import.meta.url);
const artifactDirectory = new URL("artifacts/", projectRoot);
const decisions = requireRecord(
  await readJson("contracts/stage-0.decisions.json"),
  "stage 0 decisions",
);
const marzban = requireRecord(decisions.marzban, "Marzban decision");
const openapi = requireRecord(marzban.openapi, "Marzban OpenAPI decision");

if (typeof openapi.file !== "string" || typeof openapi.sha256 !== "string") {
  throw new TypeError("Marzban OpenAPI file and SHA-256 must be strings");
}

const actualOpenapiHash = await sha256File(openapi.file);
if (actualOpenapiHash !== openapi.sha256) {
  throw new Error(
    `Marzban OpenAPI hash mismatch: expected ${openapi.sha256}, received ${actualOpenapiHash}`,
  );
}

const fixturePaths = [
  "contracts/telegram-stars/create-invoice-link.request.json",
  "contracts/telegram-stars/create-invoice-link.response.json",
  "contracts/telegram-stars/pre-checkout.update.json",
  "contracts/telegram-stars/successful-payment.update.json",
  "contracts/telegram-stars/refund-star-payment.request.json",
  "contracts/telegram-stars/refunded-payment.update.json",
];
const fixtureHashes = Object.fromEntries(
  await Promise.all(
    fixturePaths.map(async (fixturePath) => [
      fixturePath,
      await sha256File(fixturePath),
    ]),
  ),
);

const productionGateResult = getProductionGateResult();

const bundle = {
  contractVersion: decisions.contractVersion,
  reviewedAt: decisions.reviewedAt,
  productionGateResult,
  decisionsSha256: await sha256File("contracts/stage-0.decisions.json"),
  marzbanOpenapiSha256: actualOpenapiHash,
  fixtureHashes,
};

await mkdir(artifactDirectory, { recursive: true });
await writeFile(
  new URL("stage-0-contracts.json", artifactDirectory),
  `${JSON.stringify(bundle, null, 2)}\n`,
  "utf8",
);

const written = await readFile(
  new URL("stage-0-contracts.json", artifactDirectory),
  "utf8",
);
JSON.parse(written);

function getProductionGateResult() {
  try {
    assertProductionReady(decisions);
    return "approved";
  } catch {
    return "blocked";
  }
}
