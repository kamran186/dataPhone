import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { verifyPassword } from "../src/auth/password";
import { DatabaseInfrastructure } from "../src/database/database.infrastructure";
import { seedDemoData } from "../src/database/demo-seed";
import { PortCrypto } from "../src/ports/port.crypto";

const baseUrl = process.env.DATAPHONE_TEST_MONGO_URL;
const integration = baseUrl ? describe : describe.skip;

integration("development demo seed", () => {
  const url = new URL(baseUrl ?? "mongodb://127.0.0.1:27017/");
  url.pathname = `/dataphone_demo_test_${randomUUID().replaceAll("-", "")}`;
  const database = new DatabaseInfrastructure(url.toString());
  const previousMock = process.env.DATAPHONE_ENABLE_MOCK_CARRIER;
  const previousKey = process.env.DATAPHONE_PORT_ENCRYPTION_KEY;

  beforeAll(async () => {
    process.env.DATAPHONE_ENABLE_MOCK_CARRIER = "true";
    process.env.DATAPHONE_PORT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
      "base64",
    );
    await database.connect();
  });

  afterAll(async () => {
    if (database.isConnected()) {
      await database.nativeDb().dropDatabase();
      await database.close();
    }
    if (previousMock === undefined)
      delete process.env.DATAPHONE_ENABLE_MOCK_CARRIER;
    else process.env.DATAPHONE_ENABLE_MOCK_CARRIER = previousMock;
    if (previousKey === undefined)
      delete process.env.DATAPHONE_PORT_ENCRYPTION_KEY;
    else process.env.DATAPHONE_PORT_ENCRYPTION_KEY = previousKey;
  });

  it("creates usable sample records and remains idempotent", async () => {
    await seedDemoData(database, "Admin@123456");
    const db = database.nativeDb();
    const counts = Object.fromEntries(
      await Promise.all(
        [
          "users",
          "customers",
          "phone_numbers",
          "number_assignments",
          "number_events",
          "purchase_orders",
          "port_requests",
          "background_jobs",
          "carrier_sync_runs",
          "reconciliation_issues",
          "port_documents",
        ].map(
          async (name) =>
            [name, await db.collection(name).countDocuments()] as const,
        ),
      ),
    );
    expect(counts).toMatchObject({
      users: 4,
      customers: 3,
      phone_numbers: 16,
      number_assignments: 10,
      number_events: 3,
      purchase_orders: 2,
      port_requests: 4,
      background_jobs: 3,
      carrier_sync_runs: 2,
      reconciliation_issues: 2,
      port_documents: 1,
    });
    const roles = await db.collection("users").find().toArray();
    expect(new Set(roles.flatMap((user) => user.roleKeys as string[]))).toEqual(
      new Set([
        "SUPER_ADMIN",
        "OPERATIONS_MANAGER",
        "OPERATIONS_STAFF",
        "VIEWER",
      ]),
    );
    expect(
      await verifyPassword("Admin@123456", roles[0].passwordHash as string),
    ).toBe(true);
    const document = await db.collection("port_documents").findOne();
    expect(document).not.toBeNull();
    const sealed = await database.downloadDocument(document!.fileId);
    expect(new PortCrypto().decrypt(sealed).subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    await seedDemoData(database, "Admin@123456");
    for (const [name, count] of Object.entries(counts))
      expect(await db.collection(name).countDocuments()).toBe(count);
    expect(
      await db
        .collection("audit_chain_heads")
        .findOne({ _id: "global" as never }),
    ).toMatchObject({ sequence: 3 });
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await expect(seedDemoData(database, "Admin@123456")).rejects.toThrow(
        "disabled in production",
      );
    } finally {
      process.env.NODE_ENV = previousEnvironment;
    }
  });
});
