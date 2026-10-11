import { DatabaseInfrastructure } from "./database.infrastructure";
import { initialRoles } from "../auth/permissions";

export async function seedCoreRoles(
  database: DatabaseInfrastructure,
): Promise<void> {
  await database.initializeSchema();
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
