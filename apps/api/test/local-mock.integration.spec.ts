import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { LocalMockAdapter, localMockEnabled } from "../src/carriers/local-mock";
import { CarrierRegistryService } from "../src/carriers/registry";
import { loadConfig } from "../src/config/app-config";
import { DatabaseService } from "../src/database/database.service";
import { seedCarriers } from "../src/database/seed";

const baseUrl = process.env.DATAPHONE_TEST_MONGO_URL;
const integration = baseUrl ? describe : describe.skip;
integration("explicit local mock carrier", () => {
  let database: DatabaseService;
  const previous = process.env.DATAPHONE_ENABLE_MOCK_CARRIER;
  beforeAll(async () => {
    process.env.DATAPHONE_ENABLE_MOCK_CARRIER = "true";
    const url = new URL(baseUrl ?? "mongodb://127.0.0.1:27017/");
    url.pathname = `/dataphone_phase11_mock_${randomUUID().replaceAll("-", "")}`;
    database = new DatabaseService(
      loadConfig({ MONGO_URI: url.toString(), NODE_ENV: "test" }),
    );
    await database.ensureReady();
    await seedCarriers(database);
  });
  afterAll(async () => {
    if (database?.isConnected()) await database.nativeDb().dropDatabase();
    await database?.close();
    if (previous === undefined)
      delete process.env.DATAPHONE_ENABLE_MOCK_CARRIER;
    else process.env.DATAPHONE_ENABLE_MOCK_CARRIER = previous;
  });
  it("enables local operations while preserving a production deny guard", async () => {
    expect(localMockEnabled()).toBe(true);
    expect(
      await database
        .nativeDb()
        .collection("carriers")
        .countDocuments({ code: "mock" }),
    ).toBe(1);
    const registry = new CarrierRegistryService(database);
    expect(registry.capabilities("mock")).toContain("port.submit");
    const adapter = new LocalMockAdapter(database);
    const accountId = new ObjectId(),
      carrierId = (await database
        .nativeDb()
        .collection("carriers")
        .findOne({ code: "mock" }))!._id;
    await database.nativeDb().collection("carrier_accounts").insertOne({
      _id: accountId,
      carrierId,
      externalAccountId: "sandbox",
      status: "active",
    });
    const account = {
      id: accountId.toHexString(),
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
    await database.nativeDb().collection("phone_numbers").insertOne({
      _id: new ObjectId(),
      e164: offer.e164,
      carrierId,
      carrierAccountId: accountId,
      carrierNumberId: offer.e164,
      status: "active",
    });
    expect((await adapter.listInventory(account, {})).numbers[0].e164).toBe(
      offer.e164,
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
