import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { DatabaseInfrastructure } from "../src/database/database.infrastructure";
import { coreEntityNames, type CustomerRecord } from "../src/database/entities";
import { normalizeE164 } from "../src/database/phone-number";
import { seedCoreRoles } from "../src/database/seed";

const baseUrl = process.env.DATAPHONE_TEST_MONGO_URL;
const integration = baseUrl ? describe : describe.skip;

integration("MongoDB infrastructure", () => {
  const scopedUrl = new URL(baseUrl ?? "mongodb://127.0.0.1:27017/");
  const databaseName = `dataphone_phase2_test_${randomUUID().replaceAll("-", "")}`;
  scopedUrl.pathname = `/${databaseName}`;
  const database = new DatabaseInfrastructure(scopedUrl.toString());

  beforeAll(async () => {
    await database.connect();
  });

  afterAll(async () => {
    if (database.isConnected()) {
      await database.nativeDb().dropDatabase();
      await database.close();
    }
  });

  it("persists CRUD through a TypeORM Mongo repository in the same database as the native client", async () => {
    const customers = database.repository<CustomerRecord>("Customer");
    const saved = await customers.save({
      name: "Example Customer",
      externalId: "cust-1",
      status: "active",
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(saved._id).toBeInstanceOf(ObjectId);
    expect(
      await database
        .nativeDb()
        .collection("customers")
        .findOne({ _id: saved._id }),
    ).toMatchObject({ name: "Example Customer" });
    await customers.updateOne(
      { _id: saved._id },
      { $set: { name: "Updated Customer" } },
    );
    expect((await customers.findOneBy({ _id: saved._id }))?.name).toBe(
      "Updated Customer",
    );
    await customers.deleteOne({ _id: saved._id });
    expect(await customers.findOneBy({ _id: saved._id })).toBeNull();
  });

  it("creates rerunnable versioned indexes and prevents duplicate identities", async () => {
    await database.initializeSchema();
    await database.initializeSchema();
    expect(
      await database
        .nativeDb()
        .collection("schema_migrations")
        .findOne({
          _id: "core-v1" as never,
        }),
    ).toMatchObject({ version: 1 });
    const indexes = await database
      .nativeDb()
      .collection("phone_numbers")
      .indexInformation();
    expect(indexes).toHaveProperty("uq_phone_numbers_e164");
    await database
      .nativeDb()
      .collection("phone_numbers")
      .insertOne({ e164: "+12125550100" });
    await expect(
      database
        .nativeDb()
        .collection("phone_numbers")
        .insertOne({ e164: "+12125550100" }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("commits all related writes and rolls back all writes on failure", async () => {
    await database.withTransaction(async (db, session) => {
      await db
        .collection("customers")
        .insertOne({ name: "committed" }, { session });
      await db
        .collection("number_events")
        .insertOne({ type: "committed" }, { session });
    });
    await expect(
      database.withTransaction(async (db, session) => {
        await db.collection("customers").insertOne(
          { name: "rolled-back" },
          {
            session,
          },
        );
        await db
          .collection("number_events")
          .insertOne({ type: "rolled-back" }, { session });
        throw new Error("reject transaction");
      }),
    ).rejects.toThrow("reject transaction");
    expect(
      await database.nativeDb().collection("customers").countDocuments({
        name: "rolled-back",
      }),
    ).toBe(0);
    expect(
      await database.nativeDb().collection("number_events").countDocuments({
        type: "rolled-back",
      }),
    ).toBe(0);
  });

  it("rejects concurrent updates made against a stale version", async () => {
    const id = new ObjectId();
    await database.nativeDb().collection("customers").insertOne({
      _id: id,
      name: "original",
      version: 1,
    });
    const results = await Promise.allSettled([
      database.updateWithVersion("customers", id, 1, { name: "first" }),
      database.updateWithVersion("customers", id, 1, { name: "second" }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
      await database.nativeDb().collection("customers").findOne({ _id: id }),
    ).toMatchObject({ version: 2 });
  });

  it("does not offer versioned updates for append-only event collections", async () => {
    await expect(
      database.updateWithVersion("security_audit_events", new ObjectId(), 1, {
        action: "altered",
      }),
    ).rejects.toThrow("append-only");
  });

  it("round trips document bytes through GridFS", async () => {
    const content = Buffer.from("DataPhone Phase 2 document");
    const id = await database.uploadDocument("sample.txt", content);
    expect(await database.downloadDocument(id)).toEqual(content);
  });

  it("persists through a client restart and remains healthy", async () => {
    await database.nativeDb().collection("customers").insertOne({
      externalId: "persistent-customer",
    });
    await database.close();
    await database.connect();
    await database.ping();
    expect(
      await database.nativeDb().collection("customers").findOne({
        externalId: "persistent-customer",
      }),
    ).not.toBeNull();
  });

  it("registers a TypeORM repository for each core collection", () => {
    expect(coreEntityNames).toHaveLength(18);
    for (const name of coreEntityNames) {
      expect(database.repository(name).metadata.tableName).toBeTruthy();
    }
  });

  it("uses date and boolean metadata for indexed job and lifecycle fields", () => {
    const jobs = database.repository("BackgroundJob").metadata;
    expect(jobs.findColumnWithPropertyName("runAt")?.type).toBe(Date);
    expect(jobs.findColumnWithPropertyName("leaseUntil")?.type).toBe(Date);
    expect(
      database
        .repository("CarrierSyncRun")
        .metadata.findColumnWithPropertyName("startedAt")?.type,
    ).toBe(Date);
    expect(
      database
        .repository("ReconciliationIssue")
        .metadata.findColumnWithPropertyName("detectedAt")?.type,
    ).toBe(Date);
    expect(
      database
        .repository("NumberAssignment")
        .metadata.findColumnWithPropertyName("active")?.type,
    ).toBe(Boolean);
  });

  it("seeds the four initial roles idempotently", async () => {
    await seedCoreRoles(database);
    const first = await database
      .nativeDb()
      .collection("roles")
      .find({}, { projection: { key: 1 } })
      .toArray();
    await seedCoreRoles(database);
    const second = await database
      .nativeDb()
      .collection("roles")
      .find({}, { projection: { key: 1 } })
      .toArray();
    expect(first.map((role) => role.key).sort()).toEqual([
      "OPERATIONS_MANAGER",
      "OPERATIONS_STAFF",
      "SUPER_ADMIN",
      "VIEWER",
    ]);
    expect(second).toEqual(first);
  });
});

describe("phone number normalization", () => {
  it("produces canonical E.164 and rejects malformed numbers", () => {
    expect(normalizeE164("+1 (212) 555-0100")).toBe("+12125550100");
    expect(() => normalizeE164("2125550100")).toThrow();
    expect(() => normalizeE164("+0123")).toThrow();
  });
});
