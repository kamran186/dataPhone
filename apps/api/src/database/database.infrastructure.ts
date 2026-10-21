import { Pool, DatabaseError } from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { SqlDatabase, type Id, type Row } from "./query";
import { migrate } from "./schema";
export class ConcurrencyConflictError extends Error {
  constructor() {
    super("Record was changed by another operation");
  }
}
const appendOnlyTables = new Set([
  "number_events",
  "job_events",
  "security_audit_events",
  "port_events",
]);
export class DatabaseInfrastructure {
  private pool?: Pool;
  private testSchema?: string;
  private readonly transactionContext = new AsyncLocalStorage<SqlDatabase>();
  constructor(private readonly url: string) {}
  async connect() {
    if (this.pool) return;
    const url = new URL(this.url);
    const schema = url.searchParams.get("schema");
    url.searchParams.delete("schema");
    if (
      schema &&
      (process.env.NODE_ENV !== "test" ||
        !/^dataphone_[a-z0-9_]+$/.test(schema))
    )
      throw new Error("Only isolated test schemas are supported");
    if (schema) {
      const admin = new Pool({ connectionString: url.toString() });
      try {
        await admin.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      } finally {
        await admin.end();
      }
      this.testSchema = schema;
    }
    const pool = new Pool({
      connectionString: url.toString(),
      connectionTimeoutMillis: 5000,
      max: 12,
      ...(schema ? { options: `-c search_path=${schema}` } : {}),
    });
    pool.on("error", () => {
      process.stderr.write(
        '{"level":"error","event":"database_connection_lost"}\n',
      );
    });
    try {
      await pool.query("SELECT 1");
      this.pool = pool;
    } catch (error) {
      await pool.end();
      throw error;
    }
  }
  isConnected() {
    return Boolean(this.pool);
  }
  sql(): SqlDatabase {
    const tx = this.transactionContext.getStore();
    if (tx) return tx;
    if (!this.pool) throw new Error("Database is not connected");
    return new SqlDatabase(this.pool);
  }
  async initializeSchema() {
    await migrate(this.sql());
  }
  async withTransaction<T>(
    work: (db: SqlDatabase, session: SqlDatabase) => Promise<T>,
  ): Promise<T> {
    if (!this.pool) throw new Error("Database is not connected");
    for (let attempt = 0; ; attempt++) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        const tx = new SqlDatabase(client, true);
        const result = await this.transactionContext.run(tx, () =>
          work(tx, tx),
        );
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        if (
          error instanceof DatabaseError &&
          ["40001", "40P01"].includes(error.code ?? "") &&
          attempt < 5
        )
          continue;
        throw error;
      } finally {
        client.release();
      }
    }
  }
  async updateWithVersion(table: string, id: Id, version: number, fields: Row) {
    if (appendOnlyTables.has(table)) throw new Error(`${table} is append-only`);
    if ("id" in fields || "version" in fields || "updatedAt" in fields)
      throw new Error("Immutable or managed field cannot be updated");
    const result = await this.sql()
      .table(table)
      .updateOne(
        { id, version },
        {
          $set: fields,
          $inc: { version: 1 },
          $currentDate: { updatedAt: true },
        },
      );
    if (!result.matchedCount) throw new ConcurrencyConflictError();
  }
  async uploadDocument(filename: string, content: Buffer): Promise<Id> {
    if (content.length > 5 * 1024 * 1024 + 128)
      throw new Error("Document exceeds storage limit");
    return (
      await this.sql().table("document_bytes").insertOne({ filename, content })
    ).insertedId;
  }
  async downloadDocument(id: Id): Promise<Buffer> {
    const row = await this.sql().table("document_bytes").findOne({ id });
    if (!row) throw new Error("Document not found");
    return row.content as Buffer;
  }
  async deleteDocument(id: Id) {
    await this.sql().table("document_bytes").deleteOne({ id });
  }
  async ping() {
    await this.sql().query("SELECT 1");
  }
  async dropTestSchema() {
    if (process.env.NODE_ENV !== "test" || !this.testSchema)
      throw new Error("Refusing to drop a non-test schema");
    await this.sql().query(`DROP SCHEMA "${this.testSchema}" CASCADE`);
  }
  async resetTestTables(names: string[]) {
    if (process.env.NODE_ENV !== "test" || !this.testSchema)
      throw new Error("Refusing to reset a non-test schema");
    for (const name of names) this.sql().table(name);
    await this.sql().query(
      `TRUNCATE ${names.map((name) => `"${name}"`).join(",")} CASCADE`,
    );
  }
  async close() {
    const pool = this.pool;
    this.pool = undefined;
    await pool?.end();
  }
}
