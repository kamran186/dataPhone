import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Id, uuid } from "../src/database/query";
import {
  CarrierRegistry,
  CarrierRegistryService,
} from "../src/carriers/registry";
import { loadConfig } from "../src/config/app-config";
import { DatabaseService } from "../src/database/database.service";
import { JobStore } from "../src/jobs/job.store";
import { AssignmentsService } from "../src/ownership/assignments.service";
import { AuditService } from "../src/ownership/audit.service";
import { PortOperations } from "../src/ports/port.operations";
import { PortRequests } from "../src/ports/port.requests";

const baseUrl = process.env.DATAPHONE_TEST_DATABASE_URL;
const integration = baseUrl ? describe : describe.skip;
integration("port submission workflow", () => {
  let database: DatabaseService;
  let accountId: Id;
  let customerId: Id;
  let registry: CarrierRegistryService;
  let requests: PortRequests;
  let operations: PortOperations;
  const previousKey = process.env.DATAPHONE_PORT_ENCRYPTION_KEY;
  const context = {
    signal: new AbortController().signal,
    reportProgress: async () => undefined,
  };

  beforeAll(async () => {
    process.env.DATAPHONE_PORT_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString(
      "base64",
    );
    const url = new URL(
      baseUrl ?? "postgresql://dataphone:dataphone@127.0.0.1:54329/dataphone",
    );
    url.searchParams.set(
      "schema",
      `dataphone_phase9_operations_${randomUUID().replaceAll("-", "")}`,
    );
    database = new DatabaseService(
      loadConfig({ DATABASE_URL: url.toString(), NODE_ENV: "test" }),
    );
    await database.ensureReady();
    accountId = uuid();
    customerId = uuid();
    const carrierId = uuid();
    await database
      .sql()
      .table("carriers")
      .insertOne({ id: carrierId, code: "mock", displayName: "Mock" });
    await database.sql().table("carrier_accounts").insertOne({
      id: accountId,
      carrierId,
      externalAccountId: "sandbox-port",
      status: "active",
    });
    await database.sql().table("customers").insertOne({
      id: customerId,
      name: "Port Customer",
      status: "active",
    });
    registry = new CarrierRegistry([
      {
        code: "mock",
        capabilities: new Set(["port.submit", "order.status"] as const),
        portSubmission: {
          submitPort: async () => ({
            nativeOrderId: "port-native-1",
            status: "pending",
            numbers: [],
            nativeStatus: "FOC_CONFIRMED",
            focDate: "2026-11-12",
          }),
        },
        orderStatus: {
          getOrderStatus: async () => ({
            nativeOrderId: "port-native-1",
            status: "complete",
            numbers: ["+18043024189"],
            nativeStatus: "COMPLETED",
          }),
        },
      },
    ]) as CarrierRegistryService;
    const audit = new AuditService(database);
    requests = new PortRequests(database, registry, audit);
    operations = new PortOperations(
      database,
      registry,
      new JobStore(database),
      new AssignmentsService(database, audit),
      audit,
    );
  });

  afterAll(async () => {
    if (database?.isConnected()) await database.dropTestSchema();
    await database?.close();
    if (previousKey === undefined)
      delete process.env.DATAPHONE_PORT_ENCRYPTION_KEY;
    else process.env.DATAPHONE_PORT_ENCRYPTION_KEY = previousKey;
  });

  it("keeps FOC separate from completion and assigns only confirmed numbers", async () => {
    const actorId = uuid();
    const port = await requests.create(
      {
        customerId,
        carrierAccountId: accountId,
        numbers: ["+18043024189"],
        currentProvider: "Old Carrier",
        accountName: "Port Customer",
        accountNumber: "acct-123",
        pin: "1234",
        serviceAddress: {
          line1: "1 Main St",
          city: "Richmond",
          region: "VA",
          postalCode: "23220",
        },
      },
      actorId,
    );
    const submitted = await operations.submit(uuid(port.id), actorId);
    expect(submitted.status).toBe("SUBMITTED");
    expect(submitted.jobId).toBeDefined();
    const pending = await operations.process(uuid(port.id), context);
    expect(pending.status).toBe("DATE_CONFIRMED");
    expect((await requests.get(uuid(port.id))).focDate).toBeDefined();
    expect(await database.sql().table("phone_numbers").count()).toBe(0);
    const complete = await operations.track(uuid(port.id), context);
    expect(complete.status).toBe("COMPLETED");
    expect(
      await database
        .sql()
        .table("phone_numbers")
        .count({ e164: "+18043024189" }),
    ).toBe(1);
    expect(
      await database
        .sql()
        .table("number_assignments")
        .count({ customerId, active: true }),
    ).toBe(1);
    expect((await new AuditService(database).verify()).valid).toBe(true);
    await operations.track(uuid(port.id), context);
    expect(await database.sql().table("number_assignments").count()).toBe(1);
  });

  it("corrects a rejected port and resubmits a new carrier order", async () => {
    const actorId = uuid();
    const port = await requests.create(
      {
        customerId,
        carrierAccountId: accountId,
        numbers: ["+18043024190"],
        currentProvider: "Old Carrier",
        accountName: "Port Customer",
        accountNumber: "acct-456",
        pin: "5678",
        serviceAddress: {
          line1: "2 Main St",
          city: "Richmond",
          region: "VA",
          postalCode: "23220",
        },
      },
      actorId,
    );
    const id = uuid(port.id);
    await operations.submit(id, actorId);
    expect(
      (
        await operations.process(id, context, {
          nativeOrderId: "rejected-order",
          status: "failed",
          numbers: [],
          rejectionReason: "Account PIN mismatch",
        })
      ).status,
    ).toBe("REJECTED");
    expect((await requests.get(id)).rejectionReason).toBe(
      "Account PIN mismatch",
    );
    await requests.correct(id, { pin: "7890" }, actorId);
    expect((await operations.submit(id, actorId, true)).status).toBe(
      "SUBMITTED",
    );
    expect((await operations.process(id, context)).status).toBe(
      "DATE_CONFIRMED",
    );
    expect((await requests.get(id)).nativeOrderId).toBe("port-native-1");
  });

  it("keeps partial completion open and assigns only confirmed numbers", async () => {
    const actorId = uuid();
    const port = await requests.create(
      {
        customerId,
        carrierAccountId: accountId,
        numbers: ["+18043024191", "+18043024192"],
        currentProvider: "Old Carrier",
        accountName: "Port Customer",
        accountNumber: "acct-789",
        pin: "1234",
        serviceAddress: {
          line1: "3 Main St",
          city: "Richmond",
          region: "VA",
          postalCode: "23220",
        },
      },
      actorId,
    );
    const id = uuid(port.id);
    await operations.submit(id, actorId);
    expect(
      (
        await operations.process(id, context, {
          nativeOrderId: "partial-order",
          status: "complete",
          numbers: ["+18043024191"],
        })
      ).status,
    ).toBe("SUBMITTED");
    expect((await requests.get(id)).unfulfilledCount).toBe(1);
    expect(
      await database.sql().table("number_assignments").count({
        customerId,
        active: true,
      }),
    ).toBe(2);
    expect(
      await database.sql().table("background_jobs").count({
        type: "port.track",
        "payload.portId": port.id,
      }),
    ).toBeGreaterThan(0);
  });
});
