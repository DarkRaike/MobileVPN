import { randomBytes } from "node:crypto";

const DEFAULT_DEVELOPMENT_DATABASE_URL = "./data/astra-vpn.sqlite";

interface DevelopmentEnvironment {
  environment: NodeJS.ProcessEnv;
  generatedSessionSecret: boolean;
  enabledMockAuthentication: boolean;
}

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function createDevelopmentEnvironment(
  source: NodeJS.ProcessEnv,
  createSessionSecret = () => randomBytes(48).toString("base64url"),
): DevelopmentEnvironment {
  const requestedNodeEnvironment = source.NODE_ENV?.trim();

  if (requestedNodeEnvironment && requestedNodeEnvironment !== "development") {
    throw new Error(
      `The development server cannot run with NODE_ENV=${requestedNodeEnvironment}`,
    );
  }

  const environment: NodeJS.ProcessEnv = {
    ...source,
    NODE_ENV: "development",
  };
  const generatedSessionSecret = !hasValue(environment.SESSION_SECRET);
  const enabledMockAuthentication =
    !hasValue(environment.ENABLE_DEV_MOCK_AUTH) &&
    !hasValue(environment.TELEGRAM_BOT_TOKEN);

  if (generatedSessionSecret) {
    environment.SESSION_SECRET = createSessionSecret();
  }

  if (!hasValue(environment.DATABASE_URL)) {
    environment.DATABASE_URL = DEFAULT_DEVELOPMENT_DATABASE_URL;
  }

  if (enabledMockAuthentication) {
    environment.ENABLE_DEV_MOCK_AUTH = "true";
  }

  return {
    enabledMockAuthentication,
    environment,
    generatedSessionSecret,
  };
}
