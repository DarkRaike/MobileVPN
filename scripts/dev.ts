import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadEnv } from "vite";

import { createDevelopmentEnvironment } from "./dev-environment";
import { parseRuntimeConfig } from "../src/lib/server/config/schema";
import { createDatabase } from "../src/lib/server/db/client";
import { migrateDatabase } from "../src/lib/server/db/migrate";
import { seedInitialCatalog } from "../src/lib/server/modules/catalog/seed";

async function prepareDatabase(databaseUrl: string): Promise<void> {
  const context = await createDatabase(databaseUrl);

  try {
    await migrateDatabase(context);
    await seedInitialCatalog(context.database);
  } finally {
    context.close();
  }
}

function startVite(environment: NodeJS.ProcessEnv): Promise<number> {
  const viteEntryPoint = fileURLToPath(
    new URL("../node_modules/vite/bin/vite.js", import.meta.url),
  );
  const viteProcess = spawn(
    process.execPath,
    [viteEntryPoint, "dev", ...process.argv.slice(2)],
    {
      cwd: process.cwd(),
      env: environment,
      stdio: "inherit",
    },
  );

  return new Promise((resolve, reject) => {
    viteProcess.once("error", reject);
    viteProcess.once("exit", (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }

      resolve(code ?? 1);
    });
  });
}

const fileEnvironment = loadEnv("development", process.cwd(), "");
const development = createDevelopmentEnvironment({
  ...fileEnvironment,
  ...process.env,
});
const config = parseRuntimeConfig(development.environment);

await prepareDatabase(config.databaseUrl);

if (development.generatedSessionSecret) {
  console.info(
    "Using an ephemeral session secret for this development process.",
  );
}

if (development.enabledMockAuthentication) {
  console.info(
    "Development mock authentication is enabled because no Telegram bot token was configured.",
  );
}

console.info("Development database migrations and catalog seed completed.");

process.exitCode = await startVite(development.environment);
