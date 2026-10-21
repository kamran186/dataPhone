import "reflect-metadata";
import { loadConfig } from "../config/app-config";
import { DatabaseInfrastructure } from "../database/database.infrastructure";
import { bootstrapAdministrator } from "./bootstrap-admin";

async function main(): Promise<void> {
  const email = process.env.DATAPHONE_BOOTSTRAP_EMAIL;
  const password = process.env.DATAPHONE_BOOTSTRAP_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "DATAPHONE_BOOTSTRAP_EMAIL and DATAPHONE_BOOTSTRAP_PASSWORD are required",
    );
  }
  const database = new DatabaseInfrastructure(
    loadConfig(process.env).databaseUrl,
  );
  try {
    await database.connect();
    await bootstrapAdministrator(database, email, password);
    process.stdout.write("Administrator initialized\n");
  } finally {
    await database.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
