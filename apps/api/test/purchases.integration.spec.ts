import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { INestApplication } from "@nestjs/common";
import { bootstrapAdministrator } from "../src/auth/bootstrap-admin";
import { createApp } from "../src/bootstrap";
import {
  CarrierRegistry,
  CarrierRegistryService,
} from "../src/carriers/registry";
import { CarrierError } from "../src/carriers/errors";
import { MockCarrierAdapter } from "../src/carriers/mock";
import { loadConfig } from "../src/config/app-config";
import { DatabaseService } from "../src/database/database.service";
import { PurchasesService } from "../src/purchases/purchases.service";
import { PurchaseOrdersService } from "../src/purchases/purchase-orders.service";
import { DisconnectService } from "../src/purchases/disconnect.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { JobStore } from "../src/jobs/job.store";
import { AuditService } from "../src/ownership/audit.service";
import { AssignmentsService } from "../src/ownership/assignments.service";

const baseUrl = process.env.DATAPHONE_TEST_MONGO_URL;
const integration = baseUrl ? describe : describe.skip;

integration("purchase and disconnect workflows", () => {
  let database: DatabaseService;
  let mockAccountId: ObjectId;
  let bandwidthAccountId: ObjectId;
  let testUri: string;

  beforeAll(async () => {
    const url = new URL(baseUrl ?? "mongodb://127.0.0.1:27017/");
    url.pathname = `/dataphone_phase8_test_${randomUUID().replaceAll("-", "")}`;
    testUri = url.toString();
    database = new DatabaseService(
      loadConfig({ MONGO_URI: testUri, NODE_ENV: "test" }),
    );
    await database.ensureReady();
    const mockCarrierId = new ObjectId();
    const bandwidth = await database
      .nativeDb()
      .collection("carriers")
      .findOne({ code: "bandwidth" });
    mockAccountId = new ObjectId();
    bandwidthAccountId = new ObjectId();
    await database
      .nativeDb()
      .collection("carriers")
      .insertOne({ _id: mockCarrierId, code: "mock", displayName: "Mock" });
    await database
      .nativeDb()
      .collection("carrier_accounts")
      .insertMany([
        {
          _id: mockAccountId,
          carrierId: mockCarrierId,
          externalAccountId: "sandbox-a",
          status: "active",
        },
        {
          _id: bandwidthAccountId,
          carrierId: bandwidth!._id,
          externalAccountId: "sandbox-b",
          status: "active",
        },
      ]);
  });

  afterAll(async () => {
    if (database?.isConnected()) await database.nativeDb().dropDatabase();
    await database?.close();
  });

  beforeEach(async () => {
    await database
      .nativeDb()
      .collection("carrier_accounts")
      .updateOne({ _id: mockAccountId }, { $set: { status: "active" } });
    for (const name of [
      "purchase_orders",
      "disconnect_requests",
      "background_jobs",
      "job_events",
      "phone_numbers",
      "number_holdings",
      "number_assignments",
      "number_events",
      "reconciliation_issues",
      "customers",
    ])
      await database.nativeDb().collection(name).deleteMany({});
    await database
      .nativeDb()
      .collection("audit_chain_heads")
      .updateOne(
        { _id: "global" as never },
        { $set: { sequence: 0, hash: "0".repeat(64) } },
      );
  });

  it("normalizes and compares multi-carrier offers while isolating one timeout", async () => {
    const registry = new CarrierRegistry([
      {
        code: "mock",
        capabilities: new Set(["number.search"] as const),
        numberSearch: {
          searchNumbers: async () => [
            {
              e164: "8043024183",
              nativeId: "mock-1",
              locality: "Richmond",
              region: "VA",
              monthlyPriceCents: 125,
              setupPriceCents: 50,
              currency: "USD",
            },
          ],
        },
      },
      {
        code: "bandwidth",
        capabilities: new Set(["number.search"] as const),
        numberSearch: {
          searchNumbers: async () => {
            throw new CarrierError("timeout", "bandwidth", "Timed out", true);
          },
        },
      },
    ]);
    const purchases = new PurchasesService(
      database,
      registry as CarrierRegistryService,
    );
    const result = await purchases.search({
      areaCode: "804",
      city: "Richmond",
      region: "VA",
      pattern: "3024",
      quantity: 2,
    });
    expect(result.offers).toMatchObject([
      {
        e164: "+18043024183",
        carrier: "mock",
        carrierAccountId: mockAccountId.toHexString(),
        monthlyPriceCents: 125,
        setupPriceCents: 50,
        currency: "USD",
      },
    ]);
    expect(result.errors).toMatchObject([
      { carrier: "bandwidth", code: "timeout" },
    ]);
  });

  it("creates one idempotent order and assigns only provider-confirmed numbers", async () => {
    let purchaseCalls = 0;
    const purchase = async () => {
      purchaseCalls += 1;
      return {
        nativeOrderId: "provider-order-1",
        status: "complete" as const,
        numbers: ["+18043024183"],
      };
    };
    const registry = new CarrierRegistry([
      {
        code: "mock",
        capabilities: new Set(["number.purchase"] as const),
        purchase: { purchaseNumbers: purchase },
      },
    ]);
    const audit = new AuditService(database);
    const orders = new PurchaseOrdersService(
      database,
      registry as CarrierRegistryService,
      new JobStore(database),
      new AssignmentsService(database, audit),
      audit,
    );
    const actorId = new ObjectId();
    const customerId = new ObjectId();
    await database.nativeDb().collection("customers").insertOne({
      _id: customerId,
      externalId: "buyer",
      name: "Buyer",
      status: "active",
      version: 1,
    });
    const input = {
      carrierAccountId: mockAccountId,
      customerId,
      nativeIds: ["mock-1", "mock-2"],
      idempotencyKey: "purchase-test-001",
    };
    const first = await orders.create(input, actorId);
    const second = await orders.create(input, actorId);
    expect(second.id).toBe(first.id);
    await expect(
      orders.create({ ...input, nativeIds: ["other"] }, actorId),
    ).rejects.toThrow("Idempotency");
    expect(
      await database
        .nativeDb()
        .collection("background_jobs")
        .countDocuments({ type: "purchase.execute" }),
    ).toBe(1);
    expect(
      await database.nativeDb().collection("phone_numbers").countDocuments(),
    ).toBe(0);
    const outcome = await orders.process(new ObjectId(first.id), {
      signal: new AbortController().signal,
      reportProgress: async () => undefined,
    });
    expect(outcome.status).toBe("partial");
    expect((await orders.get(new ObjectId(first.id))).items).toMatchObject([
      { e164: "+18043024183", status: "confirmed" },
    ]);
    expect(
      await database
        .nativeDb()
        .collection("phone_numbers")
        .countDocuments({ e164: "+18043024183" }),
    ).toBe(1);
    expect(
      await database
        .nativeDb()
        .collection("number_assignments")
        .countDocuments({ customerId, active: true }),
    ).toBe(1);
    expect(await audit.verify()).toMatchObject({ valid: true, count: 2 });
    await orders.process(new ObjectId(first.id), {
      signal: new AbortController().signal,
      reportProgress: async () => undefined,
    });
    expect(purchaseCalls).toBe(1);
    expect(
      await database
        .nativeDb()
        .collection("number_assignments")
        .countDocuments(),
    ).toBe(1);
    await database
      .nativeDb()
      .collection("customers")
      .updateOne({ _id: customerId }, { $set: { status: "inactive" } });
    await database
      .nativeDb()
      .collection("carrier_accounts")
      .updateOne({ _id: mockAccountId }, { $set: { status: "inactive" } });
    expect((await orders.create(input, actorId)).id).toBe(first.id);
    await database
      .nativeDb()
      .collection("carrier_accounts")
      .updateOne({ _id: mockAccountId }, { $set: { status: "active" } });
  });

  it("keeps a timed-out carrier purchase retryable without creating inventory", async () => {
    const registry = new CarrierRegistry([
      {
        code: "mock",
        capabilities: new Set(["number.purchase"] as const),
        purchase: {
          purchaseNumbers: async () => {
            throw new CarrierError(
              "timeout",
              "mock",
              "Carrier timed out",
              true,
            );
          },
        },
      },
    ]);
    const audit = new AuditService(database);
    const orders = new PurchaseOrdersService(
      database,
      registry as CarrierRegistryService,
      new JobStore(database),
      new AssignmentsService(database, audit),
      audit,
    );
    const customerId = new ObjectId();
    await database.nativeDb().collection("customers").insertOne({
      _id: customerId,
      externalId: "timeout-buyer",
      name: "Timeout Buyer",
      status: "active",
    });
    const order = await orders.create(
      {
        carrierAccountId: mockAccountId,
        customerId,
        nativeIds: ["mock-1"],
        idempotencyKey: "purchase-timeout-001",
      },
      new ObjectId(),
    );
    await expect(
      orders.process(new ObjectId(order.id), {
        signal: new AbortController().signal,
        reportProgress: async () => undefined,
      }),
    ).rejects.toThrow("Carrier timed out");
    expect((await orders.get(new ObjectId(order.id))).status).toBe("retrying");
    expect(
      await database.nativeDb().collection("phone_numbers").countDocuments(),
    ).toBe(0);
    expect(
      await database
        .nativeDb()
        .collection("number_assignments")
        .countDocuments(),
    ).toBe(0);
  });

  it("opens a reconciliation issue when a purchased number belongs to another account", async () => {
    const registry = new CarrierRegistry([
      {
        code: "mock",
        capabilities: new Set(["number.purchase"] as const),
        purchase: {
          purchaseNumbers: async () => ({
            nativeOrderId: "conflict-order",
            status: "complete" as const,
            numbers: ["+18043024183"],
          }),
        },
      },
    ]);
    const audit = new AuditService(database);
    const orders = new PurchaseOrdersService(
      database,
      registry as CarrierRegistryService,
      new JobStore(database),
      new AssignmentsService(database, audit),
      audit,
    );
    const customerId = new ObjectId();
    await database.nativeDb().collection("customers").insertOne({
      _id: customerId,
      externalId: "conflict-buyer",
      name: "Conflict Buyer",
      status: "active",
      version: 1,
    });
    await database
      .nativeDb()
      .collection("phone_numbers")
      .insertOne({
        _id: new ObjectId(),
        e164: "+18043024183",
        carrierAccountId: bandwidthAccountId,
        carrierId: (await database
          .nativeDb()
          .collection("carrier_accounts")
          .findOne({ _id: bandwidthAccountId }))!.carrierId,
        status: "active",
      });
    const order = await orders.create(
      {
        carrierAccountId: mockAccountId,
        customerId,
        nativeIds: ["mock-conflict"],
        idempotencyKey: "purchase-conflict-001",
      },
      new ObjectId(),
    );
    expect(
      (
        await orders.process(new ObjectId(order.id), {
          signal: new AbortController().signal,
          reportProgress: async () => undefined,
        })
      ).status,
    ).toBe("failed");
    expect(
      await database
        .nativeDb()
        .collection("number_assignments")
        .countDocuments(),
    ).toBe(0);
    expect(
      await database
        .nativeDb()
        .collection("reconciliation_issues")
        .countDocuments({
          e164: "+18043024183",
          type: "purchase_conflict",
          status: "open",
        }),
    ).toBe(1);
  });

  it("records provider failure without assigning a number", async () => {
    const registry = new CarrierRegistry([
      {
        code: "mock",
        capabilities: new Set(["number.purchase"] as const),
        purchase: {
          purchaseNumbers: async () => ({
            nativeOrderId: "failed-1",
            status: "failed",
            numbers: [],
          }),
        },
      },
    ]);
    const audit = new AuditService(database);
    const orders = new PurchaseOrdersService(
      database,
      registry as CarrierRegistryService,
      new JobStore(database),
      new AssignmentsService(database, audit),
      audit,
    );
    const customerId = new ObjectId();
    await database.nativeDb().collection("customers").insertOne({
      _id: customerId,
      externalId: "failure-buyer",
      name: "Failure Buyer",
      status: "active",
    });
    const order = await orders.create(
      {
        carrierAccountId: mockAccountId,
        customerId,
        nativeIds: ["mock-1"],
        idempotencyKey: "purchase-failure-001",
      },
      new ObjectId(),
    );
    const result = await orders.process(new ObjectId(order.id), {
      signal: new AbortController().signal,
      reportProgress: async () => undefined,
    });
    expect(result.status).toBe("failed");
    expect((await orders.get(new ObjectId(order.id))).errorCode).toBe(
      "CARRIER_ORDER_FAILED",
    );
    expect(
      await database.nativeDb().collection("phone_numbers").countDocuments(),
    ).toBe(0);
  });

  it("tracks a pending carrier order until confirmation", async () => {
    const registry = new CarrierRegistry([
      {
        code: "mock",
        capabilities: new Set(["number.purchase", "order.status"] as const),
        purchase: {
          purchaseNumbers: async () => ({
            nativeOrderId: "pending-order-1",
            status: "pending",
            numbers: [],
          }),
        },
        orderStatus: {
          getOrderStatus: async () => ({
            nativeOrderId: "pending-order-1",
            status: "complete",
            numbers: ["+18043024183"],
          }),
        },
      },
    ]);
    const audit = new AuditService(database);
    const orders = new PurchaseOrdersService(
      database,
      registry as CarrierRegistryService,
      new JobStore(database),
      new AssignmentsService(database, audit),
      audit,
    );
    const customerId = new ObjectId();
    await database.nativeDb().collection("customers").insertOne({
      _id: customerId,
      externalId: "pending-buyer",
      name: "Pending Buyer",
      status: "active",
    });
    const order = await orders.create(
      {
        carrierAccountId: mockAccountId,
        customerId,
        nativeIds: ["mock-1"],
        idempotencyKey: "purchase-pending-001",
      },
      new ObjectId(),
    );
    const context = {
      signal: new AbortController().signal,
      reportProgress: async () => undefined,
    };
    expect((await orders.process(new ObjectId(order.id), context)).status).toBe(
      "pending",
    );
    expect(
      await database
        .nativeDb()
        .collection("background_jobs")
        .countDocuments({ type: "purchase.track" }),
    ).toBe(1);
    expect(
      await database.nativeDb().collection("phone_numbers").countDocuments(),
    ).toBe(0);
    expect((await orders.track(new ObjectId(order.id), context)).status).toBe(
      "completed",
    );
    expect(
      await database
        .nativeDb()
        .collection("phone_numbers")
        .countDocuments({ e164: "+18043024183" }),
    ).toBe(1);
    expect(
      await database
        .nativeDb()
        .collection("number_assignments")
        .countDocuments({ customerId, active: true }),
    ).toBe(1);
  });

  it("requires literal confirmation and closes ownership only after disconnect completion", async () => {
    const registry = new CarrierRegistry([
      {
        code: "mock",
        capabilities: new Set(["number.disconnect"] as const),
        disconnect: {
          disconnectNumber: async () => ({
            nativeOrderId: "disconnect-1",
            status: "complete",
            numbers: ["+18043024183"],
          }),
        },
      },
    ]);
    const audit = new AuditService(database);
    const assignments = new AssignmentsService(database, audit);
    const disconnects = new DisconnectService(
      database,
      registry as CarrierRegistryService,
      new JobStore(database),
      assignments,
      audit,
    );
    const numberId = new ObjectId();
    const customerId = new ObjectId();
    const actorId = new ObjectId();
    const account = await database
      .nativeDb()
      .collection("carrier_accounts")
      .findOne({ _id: mockAccountId });
    await database.nativeDb().collection("phone_numbers").insertOne({
      _id: numberId,
      e164: "+18043024183",
      carrierId: account!.carrierId,
      carrierAccountId: mockAccountId,
      carrierNumberId: "+18043024183",
      status: "active",
    });
    await database.nativeDb().collection("number_holdings").insertOne({
      _id: new ObjectId(),
      phoneNumberId: numberId,
      carrierAccountId: mockAccountId,
      status: "active",
      startedAt: new Date(),
      createdAt: new Date(),
    });
    await database.nativeDb().collection("number_assignments").insertOne({
      _id: new ObjectId(),
      phoneNumberId: numberId,
      customerId,
      active: true,
      startedAt: new Date(),
      createdAt: new Date(),
    });
    await expect(
      disconnects.create(numberId, "wrong number", "disconnect-001", actorId),
    ).rejects.toThrow("confirmation");
    const first = await disconnects.create(
      numberId,
      "+18043024183",
      "disconnect-001",
      actorId,
    );
    const repeat = await disconnects.create(
      numberId,
      "+18043024183",
      "disconnect-001",
      actorId,
    );
    expect(first.id).toBe(repeat.id);
    await expect(
      disconnects.create(numberId, "+18043024183", "disconnect-002", actorId),
    ).rejects.toThrow("already pending");
    expect(
      await database
        .nativeDb()
        .collection("number_assignments")
        .countDocuments({ active: true }),
    ).toBe(1);
    const result = await disconnects.process(new ObjectId(first.id), {
      signal: new AbortController().signal,
      reportProgress: async () => undefined,
    });
    expect(result.status).toBe("completed");
    expect(
      (
        await database
          .nativeDb()
          .collection("phone_numbers")
          .findOne({ _id: numberId })
      )?.status,
    ).toBe("disconnected");
    expect(
      await database
        .nativeDb()
        .collection("number_assignments")
        .countDocuments({ active: true }),
    ).toBe(0);
    expect(
      await database
        .nativeDb()
        .collection("number_holdings")
        .countDocuments({ status: "closed" }),
    ).toBe(1);
    expect(await audit.verify()).toMatchObject({ valid: true, count: 2 });
    const inventory = new InventoryService(
      database,
      new CarrierRegistry([
        new MockCarrierAdapter(["+18043024183"]),
      ]) as CarrierRegistryService,
    );
    await inventory.sync(mockAccountId);
    expect(
      (
        await database
          .nativeDb()
          .collection("phone_numbers")
          .findOne({ _id: numberId })
      )?.status,
    ).toBe("disconnected");
    expect(
      await database
        .nativeDb()
        .collection("reconciliation_issues")
        .countDocuments({
          e164: "+18043024183",
          type: "unexpected_reappearance",
          status: "open",
        }),
    ).toBe(1);
    await disconnects.process(new ObjectId(first.id), {
      signal: new AbortController().signal,
      reportProgress: async () => undefined,
    });
    expect(
      await database.nativeDb().collection("number_holdings").countDocuments(),
    ).toBe(1);
  });

  it("tracks a pending disconnect and leaves inventory active after provider failure", async () => {
    const numberId = new ObjectId();
    const account = await database
      .nativeDb()
      .collection("carrier_accounts")
      .findOne({ _id: mockAccountId });
    await database.nativeDb().collection("phone_numbers").insertOne({
      _id: numberId,
      e164: "+18043024183",
      carrierId: account!.carrierId,
      carrierAccountId: mockAccountId,
      status: "active",
    });
    const registry = new CarrierRegistry([
      {
        code: "mock",
        capabilities: new Set(["number.disconnect", "order.status"] as const),
        disconnect: {
          disconnectNumber: async () => ({
            nativeOrderId: "pending-disconnect",
            status: "pending" as const,
            numbers: [],
          }),
        },
        orderStatus: {
          getOrderStatus: async () => ({
            nativeOrderId: "pending-disconnect",
            status: "failed" as const,
            numbers: [],
          }),
        },
      },
    ]);
    const audit = new AuditService(database);
    const disconnects = new DisconnectService(
      database,
      registry as CarrierRegistryService,
      new JobStore(database),
      new AssignmentsService(database, audit),
      audit,
    );
    const request = await disconnects.create(
      numberId,
      "+18043024183",
      "disconnect-pending-001",
      new ObjectId(),
    );
    const context = {
      signal: new AbortController().signal,
      reportProgress: async () => undefined,
    };
    expect(
      (await disconnects.process(new ObjectId(request.id), context)).status,
    ).toBe("pending");
    expect(
      await database
        .nativeDb()
        .collection("background_jobs")
        .countDocuments({ type: "disconnect.track" }),
    ).toBe(1);
    expect(
      (await disconnects.track(new ObjectId(request.id), context)).status,
    ).toBe("failed");
    expect(
      (
        await database
          .nativeDb()
          .collection("phone_numbers")
          .findOne({ _id: numberId })
      )?.status,
    ).toBe("active");
    expect(
      await database.nativeDb().collection("number_events").countDocuments(),
    ).toBe(0);
  });

  it("protects purchase and disconnect routes and keeps live actions disabled", async () => {
    const previousUri = process.env.MONGO_URI;
    const previousSecret = process.env.JWT_SECRET;
    const previousWorker = process.env.DATAPHONE_JOB_WORKER_DISABLED;
    process.env.MONGO_URI = testUri;
    process.env.JWT_SECRET = "phase8-test-secret-with-at-least-32-bytes";
    process.env.DATAPHONE_JOB_WORKER_DISABLED = "true";
    let app: INestApplication | undefined;
    try {
      app = await createApp();
      await app.listen(0, "127.0.0.1");
      const address = app.getHttpServer().address() as { port: number };
      const root = `http://127.0.0.1:${address.port}/api/v1`;
      expect(
        (await fetch(`${root}/purchases/search?areaCode=804`)).status,
      ).toBe(401);
      await bootstrapAdministrator(
        app.get(DatabaseService),
        "purchase-admin@example.test",
        "phase8 secure administrator passphrase",
      );
      const login = await fetch(`${root}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "purchase-admin@example.test",
          password: "phase8 secure administrator passphrase",
        }),
      });
      const { accessToken } = (await login.json()) as { accessToken: string };
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      };
      const searched = await fetch(`${root}/purchases/search?areaCode=804`, {
        headers,
      });
      expect(searched.status).toBe(200);
      expect((await searched.json()) as { offers: unknown[] }).toMatchObject({
        offers: [],
      });
      const customerId = new ObjectId();
      await database.nativeDb().collection("customers").insertOne({
        _id: customerId,
        externalId: "api-buyer",
        name: "API Buyer",
        status: "active",
      });
      const purchase = await fetch(`${root}/purchases`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          carrierAccountId: mockAccountId.toHexString(),
          customerId: customerId.toHexString(),
          nativeIds: ["mock-1"],
          idempotencyKey: "api-purchase-001",
        }),
      });
      expect(purchase.status).toBe(409);
      const numberId = new ObjectId();
      const bandwidth = await database
        .nativeDb()
        .collection("carrier_accounts")
        .findOne({ _id: bandwidthAccountId });
      await database.nativeDb().collection("phone_numbers").insertOne({
        _id: numberId,
        e164: "+18043024183",
        carrierId: bandwidth!.carrierId,
        carrierAccountId: bandwidthAccountId,
        status: "active",
      });
      const disconnected = await fetch(
        `${root}/numbers/${numberId.toHexString()}/disconnect`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            confirmE164: "+18043024183",
            idempotencyKey: "api-disconnect-001",
          }),
        },
      );
      expect(disconnected.status).toBe(403);
      expect(
        await database
          .nativeDb()
          .collection("disconnect_requests")
          .countDocuments(),
      ).toBe(0);
    } finally {
      await app?.close();
      if (previousUri === undefined) delete process.env.MONGO_URI;
      else process.env.MONGO_URI = previousUri;
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
      if (previousWorker === undefined)
        delete process.env.DATAPHONE_JOB_WORKER_DISABLED;
      else process.env.DATAPHONE_JOB_WORKER_DISABLED = previousWorker;
    }
  });
});
