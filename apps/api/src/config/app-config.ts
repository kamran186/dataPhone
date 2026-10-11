export interface AppConfig {
  port: number;
  mongoUri: string;
  corsOrigin: string;
  environment: "development" | "test" | "production";
}

export const APP_CONFIG = Symbol("APP_CONFIG");

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const mongoUri = env.MONGO_URI;
  if (!mongoUri) throw new Error("MONGO_URI is required");
  const parsed = new URL(mongoUri);
  if (
    !["mongodb:", "mongodb+srv:"].includes(parsed.protocol) ||
    parsed.pathname.length < 2
  ) {
    throw new Error(
      "MONGO_URI must be a MongoDB URL with an explicit database name",
    );
  }
  const port = Number(env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be a valid TCP port");
  const environment = env.NODE_ENV ?? "development";
  if (!["development", "test", "production"].includes(environment))
    throw new Error("NODE_ENV is invalid");
  const corsOrigin = env.CORS_ORIGIN ?? "http://localhost:5173";
  const origin = new URL(corsOrigin);
  if (!["http:", "https:"].includes(origin.protocol))
    throw new Error("CORS_ORIGIN must be HTTP or HTTPS");
  return {
    port,
    mongoUri,
    corsOrigin: origin.origin,
    environment: environment as AppConfig["environment"],
  };
}
