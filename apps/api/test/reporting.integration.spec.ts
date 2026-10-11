import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { loadConfig } from "../src/config/app-config";
import { DatabaseService } from "../src/database/database.service";
import { reportCsv, reportXlsx } from "../src/reporting/reporting.export";
import { ReportingService } from "../src/reporting/reporting.service";

const baseUrl = process.env.DATAPHONE_TEST_MONGO_URL;
const integration = baseUrl ? describe : describe.skip;
integration("operational reporting", () => {
  let database: DatabaseService;
  let reports: ReportingService;
  beforeAll(async () => {
    const url = new URL(baseUrl ?? "mongodb://127.0.0.1:27017/");
    url.pathname = `/dataphone_phase10_${randomUUID().replaceAll("-", "")}`;
    database = new DatabaseService(
      loadConfig({ MONGO_URI: url.toString(), NODE_ENV: "test" }),
    );
    await database.ensureReady();
    reports = new ReportingService(database);
    const db = database.nativeDb();
    const carrierId = new ObjectId(),
      accountId = new ObjectId(),
      customerId = new ObjectId();
    const numberA = new ObjectId(),
      numberB = new ObjectId(),
      now = new Date();
    await db
      .collection("carriers")
      .insertOne({ _id: carrierId, code: "mock", displayName: "Mock" });
    await db.collection("carrier_accounts").insertOne({
      _id: accountId,
      carrierId,
      externalAccountId: "sandbox",
      status: "active",
    });
    await db
      .collection("customers")
      .insertOne({ _id: customerId, name: "Acme", status: "active" });
    await db.collection("phone_numbers").insertMany([
      {
        _id: numberA,
        e164: "+18043024183",
        status: "active",
        carrierId,
        carrierAccountId: accountId,
        carrierNumberId: "a",
        updatedAt: now,
      },
      {
        _id: numberB,
        e164: "+18043024184",
        status: "active",
        carrierId,
        carrierAccountId: accountId,
        carrierNumberId: "b",
        updatedAt: now,
      },
    ]);
    await db.collection("number_assignments").insertOne({
      _id: new ObjectId(),
      phoneNumberId: numberA,
      customerId,
      active: true,
      startedAt: now,
    });
    await db.collection("port_requests").insertOne({
      _id: new ObjectId(),
      status: "DATE_CONFIRMED",
      numbers: ["+18043024185"],
      currentProvider: "Old Carrier",
      customerId,
      updatedAt: now,
    });
    await db.collection("purchase_orders").insertOne({
      _id: new ObjectId(),
      status: "pending",
      nativeIds: ["one"],
      customerId,
      createdAt: now,
    });
    await db.collection("carrier_sync_runs").insertOne({
      _id: new ObjectId(),
      carrierAccountId: accountId,
      status: "failed",
      errorCode: "TIMEOUT",
      startedAt: now,
      finishedAt: now,
    });
    await db
      .collection("background_jobs")
      .insertOne({ _id: new ObjectId(), status: "failed" });
  });
  afterAll(async () => {
    if (database?.isConnected()) await database.nativeDb().dropDatabase();
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
