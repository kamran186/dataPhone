import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { uuid } from "../src/database/query";
import { LocalMockAdapter, localMockEnabled } from "../src/carriers/local-mock";
import { CarrierRegistryService } from "../src/carriers/registry";
import { loadConfig } from "../src/config/app-config";
import { DatabaseService } from "../src/database/database.service";
import { seedCarriers } from "../src/database/seed";

const baseUrl = process.env.DATAPHONE_TEST_DATABASE_URL;
const integration = baseUrl ? describe : describe.skip;
integration("explicit local mock carrier", () => {
  let database: DatabaseService;
  const previous = process.env.DATAPHONE_ENABLE_MOCK_CARRIER;
  beforeAll(async () => {
    process.env.DATAPHONE_ENABLE_MOCK_CARRIER = "true";
    const url = new URL(
      baseUrl ?? "postgresql://dataphone:dataphone@127.0.0.1:54329/dataphone",
    );
    url.searchParams.set(
      "schema",
      `dataphone_phase11_mock_${randomUUID().replaceAll("-", "")}`,
    );
    database = new DatabaseService(
      loadConfig({ DATABASE_URL: url.toString(), NODE_ENV: "test" }),
    );
    await database.ensureReady();
    await seedCarriers(database);
  });
  afterAll(async () => {
    if (database?.isConnected()) await database.dropTestSchema();
    await database?.close();
    if (previous === undefined)
      delete process.env.DATAPHONE_ENABLE_MOCK_CARRIER;
    else process.env.DATAPHONE_ENABLE_MOCK_CARRIER = previous;
  });
  it("enables local operations while preserving a production deny guard", async () => {
    expect(localMockEnabled()).toBe(true);
    expect(await database.sql().table("carriers").count({ code: "mock" })).toBe(
      1,
    );
    const registry = new CarrierRegistryService(database);
    expect(registry.capabilities("mock")).toContain("port.submit");
    const adapter = new LocalMockAdapter(database);
    const accountId = uuid(),
      carrierId = (await database
        .sql()
        .table("carriers")
        .findOne({ code: "mock" }))!.id;
    await database.sql().table("carrier_accounts").insertOne({
      id: accountId,
      carrierId,
      externalAccountId: "sandbox",
      status: "active",
    });
    const account = {
      id: accountId,
      carrier: "mock" as const,
      nativeAccountId: "sandbox",
    };
    const offer = (
      await adapter.searchNumbers(account, { areaCode: "804", quantity: 1 })
    )[0];
    expect(offer.e164).toMatch(/^\+1804/);
    expect(
      (
        await adapter.purchaseNumbers(account, {
          nativeIds: [offer.nativeId],
          idempotencyKey: "same",
        })
      ).numbers,
    ).toEqual([offer.e164]);
    const submitted = await adapter.submitPort(account, {
      reference: "port-1",
      numbers: ["+18043024183"],
      documentIds: [],
    });
    expect(submitted.status).toBe("pending");
    expect(submitted.focDate).toBeDefined();
    expect(
      (await adapter.getOrderStatus(account, submitted.nativeOrderId)).numbers,
    ).toEqual(["+18043024183"]);
    await database.sql().table("phone_numbers").insertOne({
      id: uuid(),
      e164: offer.e164,
      carrierId,
      carrierAccountId: accountId,
      carrierNumberId: "seeded-carrier-number-id",
      status: "active",
    });
    expect((await adapter.listInventory(account, {})).numbers[0]).toMatchObject(
      {
        e164: offer.e164,
        nativeId: "seeded-carrier-number-id",
      },
    );
    const beforeNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(localMockEnabled()).toBe(false);
    } finally {
      process.env.NODE_ENV = beforeNodeEnv;
    }
  });
});
