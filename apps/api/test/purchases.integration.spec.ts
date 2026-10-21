import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Id, uuid } from "../src/database/query";
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

const baseUrl = process.env.DATAPHONE_TEST_DATABASE_URL;
const integration = baseUrl ? describe : describe.skip;

integration("purchase and disconnect workflows", () => {
  let database: DatabaseService;
  let mockAccountId: Id;
  let bandwidthAccountId: Id;
  let testUri: string;

  beforeAll(async () => {
    const url = new URL(
      baseUrl ?? "postgresql://dataphone:dataphone@127.0.0.1:54329/dataphone",
    );
    url.searchParams.set(
      "schema",
      `dataphone_phase8_test_${randomUUID().replaceAll("-", "")}`,
    );
    testUri = url.toString();
    database = new DatabaseService(
      loadConfig({ DATABASE_URL: testUri, NODE_ENV: "test" }),
    );
    await database.ensureReady();
    const mockCarrierId = uuid();
    const bandwidth = await database
      .sql()
      .table("carriers")
      .findOne({ code: "bandwidth" });
    mockAccountId = uuid();
    bandwidthAccountId = uuid();
    await database
      .sql()
      .table("carriers")
      .insertOne({ id: mockCarrierId, code: "mock", displayName: "Mock" });
    await database
      .sql()
      .table("carrier_accounts")
      .insertMany([
        {
          id: mockAccountId,
          carrierId: mockCarrierId,
          externalAccountId: "sandbox-a",
          status: "active",
        },
        {
          id: bandwidthAccountId,
          carrierId: bandwidth!.id,
          externalAccountId: "sandbox-b",
          status: "active",
        },
      ]);
  });

  afterAll(async () => {
    if (database?.isConnected()) await database.dropTestSchema();
    await database?.close();
  });

  beforeEach(async () => {
    await database
      .sql()
      .table("carrier_accounts")
      .updateOne({ id: mockAccountId }, { $set: { status: "active" } });
    await database.resetTestTables([
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
    ]);
    await database
      .sql()
      .table("audit_chain_heads")
      .updateOne(
        { id: "global" as never },
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
        carrierAccountId: mockAccountId,
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
    const actorId = uuid();
    const customerId = uuid();
    await database.sql().table("customers").insertOne({
      id: customerId,
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
        .sql()
        .table("background_jobs")
        .count({ type: "purchase.execute" }),
    ).toBe(1);
    expect(await database.sql().table("phone_numbers").count()).toBe(0);
    const outcome = await orders.process(uuid(first.id), {
      signal: new AbortController().signal,
      reportProgress: async () => undefined,
    });
    expect(outcome.status).toBe("partial");
    expect((await orders.get(uuid(first.id))).items).toMatchObject([
      { e164: "+18043024183", status: "confirmed" },
    ]);
    expect(
      await database
        .sql()
        .table("phone_numbers")
        .count({ e164: "+18043024183" }),
    ).toBe(1);
    expect(
      await database
        .sql()
        .table("number_assignments")
        .count({ customerId, active: true }),
    ).toBe(1);
    expect(await audit.verify()).toMatchObject({ valid: true, count: 2 });
    await orders.process(uuid(first.id), {
      signal: new AbortController().signal,
      reportProgress: async () => undefined,
    });
    expect(purchaseCalls).toBe(1);
    expect(await database.sql().table("number_assignments").count()).toBe(1);
    await database
      .sql()
      .table("customers")
      .updateOne({ id: customerId }, { $set: { status: "inactive" } });
    await database
      .sql()
      .table("carrier_accounts")
      .updateOne({ id: mockAccountId }, { $set: { status: "inactive" } });
    expect((await orders.create(input, actorId)).id).toBe(first.id);
    await database
      .sql()
      .table("carrier_accounts")
      .updateOne({ id: mockAccountId }, { $set: { status: "active" } });
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
    const customerId = uuid();
    await database.sql().table("customers").insertOne({
      id: customerId,
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
      uuid(),
    );
    await expect(
      orders.process(uuid(order.id), {
        signal: new AbortController().signal,
        reportProgress: async () => undefined,
      }),
    ).rejects.toThrow("Carrier timed out");
    expect((await orders.get(uuid(order.id))).status).toBe("retrying");
    expect(await database.sql().table("phone_numbers").count()).toBe(0);
    expect(await database.sql().table("number_assignments").count()).toBe(0);
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
    const customerId = uuid();
    await database.sql().table("customers").insertOne({
      id: customerId,
      externalId: "conflict-buyer",
      name: "Conflict Buyer",
      status: "active",
      version: 1,
    });
    await database
      .sql()
      .table("phone_numbers")
      .insertOne({
        id: uuid(),
        e164: "+18043024183",
        carrierAccountId: bandwidthAccountId,
        carrierId: (await database
          .sql()
          .table("carrier_accounts")
          .findOne({ id: bandwidthAccountId }))!.carrierId,
        status: "active",
      });
    const order = await orders.create(
      {
        carrierAccountId: mockAccountId,
        customerId,
        nativeIds: ["mock-conflict"],
        idempotencyKey: "purchase-conflict-001",
      },
      uuid(),
    );
    expect(
      (
        await orders.process(uuid(order.id), {
          signal: new AbortController().signal,
          reportProgress: async () => undefined,
        })
      ).status,
    ).toBe("failed");
    expect(await database.sql().table("number_assignments").count()).toBe(0);
    expect(
      await database.sql().table("reconciliation_issues").count({
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
    const customerId = uuid();
    await database.sql().table("customers").insertOne({
      id: customerId,
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
      uuid(),
    );
    const result = await orders.process(uuid(order.id), {
      signal: new AbortController().signal,
      reportProgress: async () => undefined,
    });
    expect(result.status).toBe("failed");
    expect((await orders.get(uuid(order.id))).errorCode).toBe(
      "CARRIER_ORDER_FAILED",
    );
    expect(await database.sql().table("phone_numbers").count()).toBe(0);
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
    const customerId = uuid();
    await database.sql().table("customers").insertOne({
      id: customerId,
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
      uuid(),
    );
    const context = {
      signal: new AbortController().signal,
      reportProgress: async () => undefined,
    };
    expect((await orders.process(uuid(order.id), context)).status).toBe(
      "pending",
    );
    expect(
      await database
        .sql()
        .table("background_jobs")
        .count({ type: "purchase.track" }),
    ).toBe(1);
    expect(await database.sql().table("phone_numbers").count()).toBe(0);
    expect((await orders.track(uuid(order.id), context)).status).toBe(
      "completed",
    );
    expect(
      await database
        .sql()
        .table("phone_numbers")
        .count({ e164: "+18043024183" }),
    ).toBe(1);
    expect(
      await database
        .sql()
        .table("number_assignments")
        .count({ customerId, active: true }),
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
    const numberId = uuid();
    const customerId = uuid();
    const actorId = uuid();
    const account = await database
      .sql()
      .table("carrier_accounts")
      .findOne({ id: mockAccountId });
    await database.sql().table("phone_numbers").insertOne({
      id: numberId,
      e164: "+18043024183",
      carrierId: account!.carrierId,
      carrierAccountId: mockAccountId,
      carrierNumberId: "+18043024183",
      status: "active",
    });
    await database.sql().table("number_holdings").insertOne({
      id: uuid(),
      phoneNumberId: numberId,
      carrierAccountId: mockAccountId,
      status: "active",
      startedAt: new Date(),
      createdAt: new Date(),
    });
    await database.sql().table("customers").insertOne({
      id: customerId,
      name: "Disconnect customer",
      status: "active",
    });
    await database.sql().table("number_assignments").insertOne({
      id: uuid(),
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
      await database.sql().table("number_assignments").count({ active: true }),
    ).toBe(1);
    const result = await disconnects.process(uuid(first.id), {
      signal: new AbortController().signal,
      reportProgress: async () => undefined,
    });
    expect(result.status).toBe("completed");
    expect(
      (await database.sql().table("phone_numbers").findOne({ id: numberId }))
        ?.status,
    ).toBe("disconnected");
    expect(
      await database.sql().table("number_assignments").count({ active: true }),
    ).toBe(0);
    expect(
      await database.sql().table("number_holdings").count({ status: "closed" }),
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
      (await database.sql().table("phone_numbers").findOne({ id: numberId }))
        ?.status,
    ).toBe("disconnected");
    expect(
      await database.sql().table("reconciliation_issues").count({
        e164: "+18043024183",
        type: "unexpected_reappearance",
        status: "open",
      }),
    ).toBe(1);
    await disconnects.process(uuid(first.id), {
      signal: new AbortController().signal,
      reportProgress: async () => undefined,
    });
    expect(await database.sql().table("number_holdings").count()).toBe(1);
  });

  it("tracks a pending disconnect and leaves inventory active after provider failure", async () => {
    const numberId = uuid();
    const account = await database
      .sql()
      .table("carrier_accounts")
      .findOne({ id: mockAccountId });
    await database.sql().table("phone_numbers").insertOne({
      id: numberId,
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
      uuid(),
    );
    const context = {
      signal: new AbortController().signal,
      reportProgress: async () => undefined,
    };
    expect((await disconnects.process(uuid(request.id), context)).status).toBe(
      "pending",
    );
    expect(
      await database
        .sql()
        .table("background_jobs")
        .count({ type: "disconnect.track" }),
    ).toBe(1);
    expect((await disconnects.track(uuid(request.id), context)).status).toBe(
      "failed",
    );
    expect(
      (await database.sql().table("phone_numbers").findOne({ id: numberId }))
        ?.status,
    ).toBe("active");
    expect(await database.sql().table("number_events").count()).toBe(0);
  });

  it("protects purchase and disconnect routes and keeps live actions disabled", async () => {
    const previousUri = process.env.DATABASE_URL;
    const previousSecret = process.env.JWT_SECRET;
    const previousWorker = process.env.DATAPHONE_JOB_WORKER_DISABLED;
    process.env.DATABASE_URL = testUri;
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
      const customerId = uuid();
      await database.sql().table("customers").insertOne({
        id: customerId,
        externalId: "api-buyer",
        name: "API Buyer",
        status: "active",
      });
      const purchase = await fetch(`${root}/purchases`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          carrierAccountId: mockAccountId,
          customerId: customerId,
          nativeIds: ["mock-1"],
          idempotencyKey: "api-purchase-001",
        }),
      });
      expect(purchase.status).toBe(409);
      const viewerResponse = await fetch(`${root}/users`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: "search-viewer@example.test",
          password: "Viewer-password-2026",
          roleKeys: ["VIEWER"],
        }),
      });
      expect(viewerResponse.status).toBe(201);
      const viewerLogin = await fetch(`${root}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "search-viewer@example.test",
          password: "Viewer-password-2026",
        }),
      });
      const viewerToken = (
        (await viewerLogin.json()) as { accessToken: string }
      ).accessToken;
      const viewerHeaders = {
        Authorization: `Bearer ${viewerToken}`,
        "Content-Type": "application/json",
      };
      expect(
        (
          await fetch(`${root}/purchases/search?areaCode=212&carrier=mock`, {
            headers: viewerHeaders,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await fetch(`${root}/purchases`, {
            method: "POST",
            headers: viewerHeaders,
            body: JSON.stringify({}),
          })
        ).status,
      ).toBe(403);
      const numberId = uuid();
      const bandwidth = await database
        .sql()
        .table("carrier_accounts")
        .findOne({ id: bandwidthAccountId });
      await database.sql().table("phone_numbers").insertOne({
        id: numberId,
        e164: "+18043024183",
        carrierId: bandwidth!.carrierId,
        carrierAccountId: bandwidthAccountId,
        status: "active",
      });
      const disconnected = await fetch(
        `${root}/numbers/${numberId}/disconnect`,
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
      expect(await database.sql().table("disconnect_requests").count()).toBe(0);
    } finally {
      await app?.close();
      if (previousUri === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUri;
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
      if (previousWorker === undefined)
        delete process.env.DATAPHONE_JOB_WORKER_DISABLED;
      else process.env.DATAPHONE_JOB_WORKER_DISABLED = previousWorker;
    }
  });
});
