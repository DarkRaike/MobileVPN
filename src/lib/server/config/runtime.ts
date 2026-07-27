import { env } from "$env/dynamic/private";

import { parseRuntimeConfig, type RuntimeConfig } from "./schema";

let runtimeConfig: RuntimeConfig | undefined;

export function getRuntimeConfig(): RuntimeConfig {
  runtimeConfig ??= parseRuntimeConfig(env);
  return runtimeConfig;
}
