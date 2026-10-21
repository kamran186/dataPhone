export interface AppConfig {
  port: number;
  databaseUrl: string;
  corsOrigin: string;
  environment: "development" | "test" | "production";
  jwtSecret?: string;
}

export const APP_CONFIG = Symbol("APP_CONFIG");

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const parsed = new URL(databaseUrl);
  if (
    !["postgresql:", "postgres:"].includes(parsed.protocol) ||
    parsed.pathname.length < 2
  ) {
    throw new Error(
      "DATABASE_URL must be a PostgreSQL URL with an explicit database name",
    );
  }
  const port = Number(env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be a valid TCP port");
  const environment = env.NODE_ENV ?? "development";
  if (!["development", "test", "production"].includes(environment))
    throw new Error("NODE_ENV is invalid");
  const jwtSecret = env.JWT_SECRET;
  if (jwtSecret && Buffer.byteLength(jwtSecret, "utf8") < 32)
    throw new Error("JWT_SECRET must be at least 32 bytes");
  if (environment === "production" && !jwtSecret)
    throw new Error("JWT_SECRET is required in production");
  const portEncryptionKey = env.DATAPHONE_PORT_ENCRYPTION_KEY;
  if (environment === "production" && !portEncryptionKey)
    throw new Error("DATAPHONE_PORT_ENCRYPTION_KEY is required in production");
  if (portEncryptionKey) {
    const decoded = Buffer.from(portEncryptionKey, "base64");
    if (
      decoded.length !== 32 ||
      decoded.toString("base64") !== portEncryptionKey
    )
      throw new Error(
        "DATAPHONE_PORT_ENCRYPTION_KEY must be exactly 32 bytes in base64",
      );
  }
  const corsOrigin = env.CORS_ORIGIN ?? "http://localhost:5173";
  const origin = new URL(corsOrigin);
  if (!["http:", "https:"].includes(origin.protocol))
    throw new Error("CORS_ORIGIN must be HTTP or HTTPS");
  return {
    port,
    databaseUrl,
    corsOrigin: origin.origin,
    environment: environment as AppConfig["environment"],
    jwtSecret,
  };
}
