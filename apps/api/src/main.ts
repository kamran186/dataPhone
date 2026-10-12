import { createApp } from "./bootstrap";
import { loadConfig } from "./config/app-config";
import { DatabaseService } from "./database/database.service";
import { seedDemoData } from "./database/demo-seed";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await createApp();
  if (process.env.DATAPHONE_SEED_DEMO === "true") {
    const password = process.env.DATAPHONE_DEMO_PASSWORD;
    if (!password) throw new Error("DATAPHONE_DEMO_PASSWORD is required");
    const database = app.get(DatabaseService);
    await database.ensureReady();
    await seedDemoData(database, password);
  }
  await app.listen(config.port, "0.0.0.0");
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ level: "error", event: "startup_failed", message: error instanceof Error ? error.message : "Unknown error" })}\n`,
  );
  process.exitCode = 1;
});
