import { DatabaseError, uuid } from "../database/query";
import { DatabaseInfrastructure } from "../database/database.infrastructure";
import { seedCoreRoles } from "../database/seed";
import { hashPassword } from "./password";

export async function bootstrapAdministrator(
  database: DatabaseInfrastructure,
  email: string,
  password: string,
): Promise<void> {
  const emailNormalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNormalized)) {
    throw new Error("Valid administrator email is required");
  }
  const passwordHash = await hashPassword(password);
  await seedCoreRoles(database);
  try {
    await database.withTransaction(async (db, session) => {
      if ((await db.table("users").count({}, { session })) > 0) {
        throw new Error("Administrator bootstrap is already initialized");
      }
      await db.table("users").insertOne(
        {
          id: uuid(),
          email: emailNormalized,
          emailNormalized,
          displayName: "Administrator",
          passwordHash,
          roleKeys: ["SUPER_ADMIN"],
          active: true,
          tokenVersion: 1,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { session },
      );
    });
  } catch (error) {
    if (
      error instanceof Error &&
      ((error instanceof DatabaseError && error.code === "23505") ||
        error.message.includes("already initialized"))
    ) {
      throw new Error("Administrator bootstrap is already initialized", {
        cause: error,
      });
    }
    throw error;
  }
}
