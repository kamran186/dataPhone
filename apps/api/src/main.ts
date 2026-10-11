import { createApp } from "./bootstrap";
import { loadConfig } from "./config/app-config";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await createApp();
  await app.listen(config.port, "0.0.0.0");
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ level: "error", event: "startup_failed", message: error instanceof Error ? error.message : "Unknown error" })}\n`,
  );
  process.exitCode = 1;
});
