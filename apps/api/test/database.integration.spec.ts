import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DatabaseInfrastructure } from "../src/database/database.infrastructure";
import { uuid } from "../src/database/query";
import { normalizeE164 } from "../src/database/phone-number";
import { seedCoreRoles } from "../src/database/seed";
const baseUrl = process.env.DATAPHONE_TEST_DATABASE_URL;
const integration = baseUrl ? describe : describe.skip;
integration("PostgreSQL infrastructure", () => {
  const url = new URL(baseUrl ?? "postgresql://localhost/dataphone");
  url.searchParams.set(
    "schema",
    `dataphone_database_${randomUUID().replaceAll("-", "")}`,
  );
  const database = new DatabaseInfrastructure(url.toString());
  beforeAll(async () => {
    await database.connect();
    await database.initializeSchema();
  });
  afterAll(async () => {
    if (database.isConnected()) {
      await database.dropTestSchema();
      await database.close();
    }
  });
  it("persists typed SQL columns and UUID identities", async () => {
    const table = database.sql().table("customers");
    const id = uuid();
    await table.insertOne({
      id,
      name: "Example",
      externalId: "cust-1",
      version: 1,
    });
    expect(await table.findOne({ id })).toMatchObject({ id, name: "Example" });
    await table.updateOne({ id }, { $set: { name: "Updated" } });
    expect((await table.findOne({ id }))?.name).toBe("Updated");
    await table.deleteOne({ id });
    expect(await table.findOne({ id })).toBeNull();
  });
  it("applies migrations once and enforces uniqueness, foreign keys and E.164", async () => {
    await database.initializeSchema();
    expect(
      (
        await database
          .sql()
          .query("SELECT count(*)::int AS count FROM schema_migrations")
      ).rows[0].count,
    ).toBe(1);
    await database
      .sql()
      .table("phone_numbers")
      .insertOne({ e164: "+12125550100" });
    await expect(
      database.sql().table("phone_numbers").insertOne({ e164: "+12125550100" }),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      database.sql().table("carrier_accounts").insertOne({ carrierId: uuid() }),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      database.sql().table("phone_numbers").insertOne({ e164: "invalid" }),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("rolls back all state and events when a transaction fails", async () => {
    await expect(
      database.withTransaction(async (tx) => {
        await tx.table("customers").insertOne({ name: "rolled-back" });
        await tx.table("number_events").insertOne({ type: "rolled-back" });
        throw new Error("reject transaction");
      }),
    ).rejects.toThrow("reject transaction");
    expect(
      await database.sql().table("customers").count({ name: "rolled-back" }),
    ).toBe(0);
    expect(
      await database
        .sql()
        .table("number_events")
        .count({ type: "rolled-back" }),
    ).toBe(0);
  });
  it("rejects stale concurrent versions", async () => {
    const id = uuid();
    await database
      .sql()
      .table("customers")
      .insertOne({ id, name: "original", version: 1 });
    const outcomes = await Promise.allSettled([
      database.updateWithVersion("customers", id, 1, { name: "first" }),
      database.updateWithVersion("customers", id, 1, { name: "second" }),
    ]);
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      (await database.sql().table("customers").findOne({ id }))?.version,
    ).toBe(2);
  });
  it("does not offer versioned mutation of append-only events", async () => {
    await expect(
      database.updateWithVersion("number_events", uuid(), 1, {
        type: "changed",
      }),
    ).rejects.toThrow("append-only");
  });
  it("stores binary bytes and survives a reconnect", async () => {
    const bytes = Buffer.from([0, 1, 255]);
    const id = await database.uploadDocument("sample", bytes);
    await database.close();
    await database.connect();
    await database.ping();
    expect(await database.downloadDocument(id)).toEqual(bytes);
  });
  it("seeds roles idempotently", async () => {
    await seedCoreRoles(database);
    const first = await database
      .sql()
      .table("roles")
      .find()
      .sort({ key: 1 })
      .toArray();
    await seedCoreRoles(database);
    expect(
      await database.sql().table("roles").find().sort({ key: 1 }).toArray(),
    ).toEqual(first);
    expect(first).toHaveLength(4);
  });
});
describe("phone number normalization", () => {
  it("validates E.164", () => {
    expect(normalizeE164("+1 (212) 555-0100")).toBe("+12125550100");
    expect(() => normalizeE164("2125550100")).toThrow();
    expect(() => normalizeE164("+0123")).toThrow();
  });
});
