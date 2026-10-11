import { DatabaseInfrastructure } from "./database.infrastructure";

const initialRoles = [
  { key: "SUPER_ADMIN", name: "Super Admin" },
  { key: "OPERATIONS_MANAGER", name: "Operations Manager" },
  { key: "OPERATIONS_STAFF", name: "Operations Staff" },
  { key: "VIEWER", name: "Viewer" },
] as const;

export async function seedCoreRoles(
  database: DatabaseInfrastructure,
): Promise<void> {
  await database.initializeSchema();
  const roles = database.nativeDb().collection("roles");
  for (const role of initialRoles) {
    await roles.updateOne(
      { key: role.key },
      {
        $setOnInsert: {
          ...role,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }
}
