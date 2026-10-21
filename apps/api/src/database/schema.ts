import type { SqlDatabase } from "./query";
import { coreSql } from "./migrations/001-core";
import type { Pool } from "pg";
export const CORE_SCHEMA_VERSION = 1;
export async function migrate(db: SqlDatabase) {
  const client = await (db.executor as Pool).connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(17362801)");
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, "appliedAt" timestamptz NOT NULL DEFAULT now())',
    );
    const result = await client.query(
      "SELECT version FROM schema_migrations WHERE version=1",
    );
    if (!result.rows.length) {
      await client.query(coreSql);
      await client.query("INSERT INTO schema_migrations (version) VALUES (1)");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
