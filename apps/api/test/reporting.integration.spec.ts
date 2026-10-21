import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { uuid } from "../src/database/query";
import { loadConfig } from "../src/config/app-config";
import { DatabaseService } from "../src/database/database.service";
import { reportCsv, reportXlsx } from "../src/reporting/reporting.export";
import { ReportingService } from "../src/reporting/reporting.service";

const baseUrl = process.env.DATAPHONE_TEST_DATABASE_URL;
const integration = baseUrl ? describe : describe.skip;
integration("operational reporting", () => {
  let database: DatabaseService;
  let reports: ReportingService;
  beforeAll(async () => {
    const url = new URL(
      baseUrl ?? "postgresql://dataphone:dataphone@127.0.0.1:54329/dataphone",
    );
    url.searchParams.set(
      "schema",
      `dataphone_phase10_${randomUUID().replaceAll("-", "")}`,
    );
    database = new DatabaseService(
      loadConfig({ DATABASE_URL: url.toString(), NODE_ENV: "test" }),
    );
    await database.ensureReady();
    reports = new ReportingService(database);
    const db = database.sql();
    const carrierId = uuid(),
      accountId = uuid(),
      customerId = uuid();
    const numberA = uuid(),
      numberB = uuid(),
      now = new Date();
    await db
      .table("carriers")
      .insertOne({ id: carrierId, code: "mock", displayName: "Mock" });
    await db.table("carrier_accounts").insertOne({
      id: accountId,
      carrierId,
      externalAccountId: "sandbox",
      status: "active",
    });
    await db
      .table("customers")
      .insertOne({ id: customerId, name: "Acme", status: "active" });
    await db.table("phone_numbers").insertMany([
      {
        id: numberA,
        e164: "+18043024183",
        status: "active",
        carrierId,
        carrierAccountId: accountId,
        carrierNumberId: "a",
        updatedAt: now,
      },
      {
        id: numberB,
        e164: "+18043024184",
        status: "active",
        carrierId,
        carrierAccountId: accountId,
        carrierNumberId: "b",
        updatedAt: now,
      },
    ]);
    await db.table("number_assignments").insertOne({
      id: uuid(),
      phoneNumberId: numberA,
      customerId,
      active: true,
      startedAt: now,
    });
    await db.table("port_requests").insertOne({
      id: uuid(),
      status: "DATE_CONFIRMED",
      numbers: ["+18043024185"],
      currentProvider: "Old Carrier",
      customerId,
      updatedAt: now,
    });
    await db.table("purchase_orders").insertOne({
      id: uuid(),
      status: "pending",
      nativeIds: ["one"],
      customerId,
      createdAt: now,
    });
    await db.table("carrier_sync_runs").insertOne({
      id: uuid(),
      carrierAccountId: accountId,
      status: "failed",
      errorCode: "TIMEOUT",
      startedAt: now,
      finishedAt: now,
    });
    await db
      .table("background_jobs")
      .insertOne({ id: uuid(), status: "failed" });
  });
  afterAll(async () => {
    if (database?.isConnected()) await database.dropTestSchema();
    await database?.close();
  });

  it("calculates active, assigned, potentially unused, pending, and failure totals", async () => {
    const dashboard = await reports.dashboard();
    expect(dashboard).toMatchObject({
      totalDids: 2,
      activeDids: 2,
      assigned: 1,
      potentiallyUnused: 1,
      openPorts: 1,
      pendingPurchases: 1,
      failedJobs: 1,
    });
    expect(dashboard.byCarrier).toEqual([{ carrier: "mock", count: 2 }]);
    expect(dashboard.carrierSync[0]).toMatchObject({
      account: "sandbox",
      status: "failed",
    });
  });
  it("returns accurate filtered reports without port secrets", async () => {
    const unassigned = await reports.report("unassigned", {});
    expect(unassigned.total).toBe(1);
    expect(unassigned.rows[0].Number).toBe("+18043024184");
    expect((await reports.report("by-customer", {})).rows[0].Customer).toBe(
      "Acme",
    );
    expect((await reports.report("open-ports", {})).rows[0].Status).toBe(
      "DATE_CONFIRMED",
    );
    expect(
      (await reports.report("sync-failures", {})).rows[0]["Error code"],
    ).toBe("TIMEOUT");
    expect((await reports.report("all-dids", { search: "4184" })).total).toBe(
      1,
    );
    await expect(reports.report("unknown", {})).rejects.toThrow(
      "Invalid report type",
    );
  });
  it("exports protected cell text safely in CSV and Excel", async () => {
    const columns = ["Number", "Customer"];
    const rows = [{ Number: "+18043024184", Customer: "=cmd" }];
    const csv = reportCsv(columns, rows);
    expect(csv).toContain("'=cmd");
    expect(csv).toContain("'+18043024184");
    const xlsx = await reportXlsx(columns, rows);
    expect(xlsx.subarray(0, 2).toString()).toBe("PK");
  });
});
