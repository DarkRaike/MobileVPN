import "dotenv/config";

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  out: "./drizzle",
  schema: "./src/lib/server/db/schema.ts",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "./data/astra-vpn.sqlite",
  },
  strict: true,
  verbose: true,
});
