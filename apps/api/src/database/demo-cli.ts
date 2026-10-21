import "reflect-metadata";
import { loadConfig } from "../config/app-config";
import { DatabaseInfrastructure } from "./database.infrastructure";
import { seedDemoData } from "./demo-seed";

async function main(): Promise<void> {
  const password = process.env.DATAPHONE_DEMO_PASSWORD;
  if (!password) throw new Error("DATAPHONE_DEMO_PASSWORD is required");
  const database = new DatabaseInfrastructure(
    loadConfig(process.env).databaseUrl,
  );
  try {
    await database.connect();
    await seedDemoData(database, password);
    process.stdout.write("Demo data is ready.\n");
  } finally {
    await database.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
