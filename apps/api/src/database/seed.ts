import { DatabaseInfrastructure } from "./database.infrastructure";
import { initialRoles } from "../auth/permissions";
import { localMockEnabled } from "../carriers/local-mock";

export async function seedCarriers(
  database: DatabaseInfrastructure,
): Promise<void> {
  const carriers = database.nativeDb().collection("carriers");
  for (const carrier of [
    { code: "peerless", displayName: "Peerless Network" },
    { code: "bulkvs", displayName: "BulkVS" },
    { code: "bandwidth", displayName: "Bandwidth" },
    ...(localMockEnabled()
      ? [{ code: "mock", displayName: "Local mock carrier" }]
      : []),
  ]) {
    await carriers.updateOne(
      { code: carrier.code },
      {
        $set: { displayName: carrier.displayName },
        $setOnInsert: { code: carrier.code, createdAt: new Date() },
      },
      { upsert: true },
    );
  }
}

export async function seedCoreRoles(
  database: DatabaseInfrastructure,
): Promise<void> {
  await database.initializeSchema();
  await seedCarriers(database);
  const roles = database.nativeDb().collection("roles");
  for (const role of initialRoles) {
    await roles.updateOne(
      { key: role.key },
      {
        $set: { name: role.name, permissions: [...role.permissions] },
        $setOnInsert: {
          key: role.key,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }
}
