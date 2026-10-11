import "reflect-metadata";
import { loadConfig } from "../config/app-config";
import { DatabaseInfrastructure } from "./database.infrastructure";
import { seedCoreRoles } from "./seed";

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "init" && command !== "seed") {
    throw new Error("Usage: database/cli.js init|seed");
  }
  const database = new DatabaseInfrastructure(loadConfig(process.env).mongoUri);
  try {
    await database.connect();
    if (command === "init") await database.initializeSchema();
    else await seedCoreRoles(database);
  } finally {
    await database.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
