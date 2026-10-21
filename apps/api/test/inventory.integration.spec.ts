import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Id, uuid } from "../src/database/query";
import type { INestApplication } from "@nestjs/common";
import ExcelJS from "exceljs";
import { bootstrapAdministrator } from "../src/auth/bootstrap-admin";
import { createApp } from "../src/bootstrap";
import { MockCarrierAdapter } from "../src/carriers/mock";
import {
  CarrierRegistry,
  CarrierRegistryService,
} from "../src/carriers/registry";
import { loadConfig } from "../src/config/app-config";
import { DatabaseService } from "../src/database/database.service";
import { InventoryService } from "../src/inventory/inventory.service";

const baseUrl = process.env.DATAPHONE_TEST_DATABASE_URL;
const integration = baseUrl ? describe : describe.skip;

integration("carrier inventory synchronization", () => {
  let database: DatabaseService;
  let carrierId: Id;
  let accountId: Id;
  let testUri: string;
  const first = "+18043024183";
  const second = "+18042121778";

  function service(numbers: string[]) {
    const registry = new CarrierRegistry([new MockCarrierAdapter(numbers)]);
    return new InventoryService(database, registry as CarrierRegistryService);
  }

  beforeAll(async () => {
    const url = new URL(
      baseUrl ?? "postgresql://dataphone:dataphone@127.0.0.1:54329/dataphone",
    );
    url.searchParams.set(
      "schema",
      `dataphone_phase6_test_${randomUUID().replaceAll("-", "")}`,
    );
    testUri = url.toString();
    database = new DatabaseService(
      loadConfig({ DATABASE_URL: testUri, NODE_ENV: "test" }),
    );
    await database.ensureReady();
    carrierId = uuid();
    accountId = uuid();
    await database
      .sql()
      .table("carriers")
      .insertOne({ id: carrierId, code: "mock", displayName: "Mock fixture" });
    await database.sql().table("carrier_accounts").insertOne({
      id: accountId,
      carrierId,
      externalAccountId: "fixture",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  beforeEach(async () => {
    await database.resetTestTables([
      "phone_numbers",
      "number_holdings",
      "number_assignments",
      "reconciliation_issues",
      "carrier_sync_runs",
    ]);
  });

  afterAll(async () => {
    if (database?.isConnected()) await database.dropTestSchema();
    await database?.close();
  });

  it("imports, repeats, and preserves one global identity", async () => {
    const firstRun = await service([first, second]).sync(accountId);
    expect(firstRun).toMatchObject({
      status: "succeeded",
      seen: 2,
      created: 2,
    });
    const secondRun = await service([first, second]).sync(accountId);
    expect(secondRun).toMatchObject({
      status: "succeeded",
      seen: 2,
      created: 0,
      updated: 2,
    });
    expect(await database.sql().table("phone_numbers").count()).toBe(2);
    expect(await database.sql().table("number_holdings").count()).toBe(2);
  });

  it("records missing carrier numbers without changing customer assignment", async () => {
    await service([first, second]).sync(accountId);
    const number = await database
      .sql()
      .table("phone_numbers")
      .findOne({ e164: second });
    const assignedCustomer = uuid();
    await database
      .sql()
      .table("customers")
      .insertOne({ id: assignedCustomer, name: "Inventory customer" });
    await database.sql().table("number_assignments").insertOne({
      phoneNumberId: number!.id,
      customerId: assignedCustomer,
      active: true,
    });
    const run = await service([first]).sync(accountId);
    expect(run.missing).toBe(1);
    expect(
      (await database.sql().table("phone_numbers").findOne({ e164: second }))
        ?.status,
    ).toBe("missing");
    expect(
      await database
        .sql()
        .table("number_assignments")
        .count({ phoneNumberId: number!.id, active: true }),
    ).toBe(1);
    expect(
      await database
        .sql()
        .table("number_holdings")
        .count({ phoneNumberId: number!.id, status: "closed" }),
    ).toBe(1);
    expect(
      await database
        .sql()
        .table("reconciliation_issues")
        .count({ e164: second, status: "open" }),
    ).toBe(1);
    await service([first, second]).sync(accountId);
    expect(
      await database
        .sql()
        .table("number_holdings")
        .count({ phoneNumberId: number!.id }),
    ).toBe(2);
    expect(
      await database
        .sql()
        .table("reconciliation_issues")
        .count({ e164: second, status: "open" }),
    ).toBe(0);
  });

  it("does not mark numbers missing when a carrier snapshot fails", async () => {
    await service([first]).sync(accountId);
    const failing = new InventoryService(
      database,
      new CarrierRegistry([
        {
          code: "mock",
          capabilities: new Set(["inventory.list"] as const),
          inventory: {
            listInventory: async () => {
              throw new Error("carrier unavailable");
            },
          },
        },
      ]) as CarrierRegistryService,
    );
    await expect(failing.sync(accountId)).rejects.toThrow(
      "carrier unavailable",
    );
    expect(
      (await database.sql().table("phone_numbers").findOne({ e164: first }))
        ?.status,
    ).toBe("active");
    expect(await database.sql().table("reconciliation_issues").count()).toBe(0);
  });

  it("keeps inventory unchanged when a later carrier page fails", async () => {
    await service([first, second]).sync(accountId);
    const failing = new InventoryService(
      database,
      new CarrierRegistry([
        {
          code: "mock",
          capabilities: new Set(["inventory.list"] as const),
          inventory: {
            listInventory: async (_account, page) => {
              if (page.pageToken) throw new Error("second page unavailable");
              return {
                numbers: [{ e164: first, nativeId: first, status: "active" }],
                nextPageToken: "page-2",
              };
            },
          },
        },
      ]) as CarrierRegistryService,
    );
    await expect(failing.sync(accountId)).rejects.toThrow(
      "second page unavailable",
    );
    expect(
      await database.sql().table("phone_numbers").count({ status: "active" }),
    ).toBe(2);
    expect(await database.sql().table("reconciliation_issues").count()).toBe(0);
  });

  it("rejects a truncated snapshot without marking existing inventory missing", async () => {
    await service([first, second]).sync(accountId);
    const registry = new CarrierRegistry([
      {
        code: "mock",
        capabilities: new Set(["inventory.list"] as const),
        inventory: {
          listInventory: async () => ({
            numbers: [{ e164: first, nativeId: first, status: "active" }],
            totalCount: 2,
          }),
        },
      },
    ]);
    await expect(
      new InventoryService(database, registry as CarrierRegistryService).sync(
        accountId,
      ),
    ).rejects.toThrow("incomplete");
    expect(
      await database.sql().table("phone_numbers").count({ status: "active" }),
    ).toBe(2);
    expect(await database.sql().table("reconciliation_issues").count()).toBe(0);
  });

  it("merges distinct carrier inventories and flags duplicate E.164 identities", async () => {
    await service([first]).sync(accountId);
    const bandwidth = await database
      .sql()
      .table("carriers")
      .findOne({ code: "bandwidth" });
    const otherAccount = uuid();
    await database.sql().table("carrier_accounts").insertOne({
      id: otherAccount,
      carrierId: bandwidth!.id,
      externalAccountId: "fixture-two",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const other = new InventoryService(
      database,
      new CarrierRegistry([
        {
          code: "bandwidth",
          capabilities: new Set(["inventory.list"] as const),
          inventory: {
            listInventory: async () => ({
              numbers: [
                { e164: first, nativeId: first, status: "active" },
                { e164: second, nativeId: second, status: "active" },
              ],
            }),
          },
        },
      ]) as CarrierRegistryService,
    );
    const result = await other.sync(otherAccount);
    expect(result.issues).toBe(1);
    expect(result.created).toBe(1);
    expect(
      await database.sql().table("phone_numbers").count({ e164: first }),
    ).toBe(1);
    expect(
      (await other.listNumbers({ carrier: "bandwidth" })).items.map(
        (item) => item.e164,
      ),
    ).toEqual([second]);
    expect(
      await database
        .sql()
        .table("reconciliation_issues")
        .count({ e164: first, type: "duplicate_carrier" }),
    ).toBe(1);
  });

  it("searches partial numbers, customer names, filters, and pages", async () => {
    await service([first, second]).sync(accountId);
    const number = await database
      .sql()
      .table("phone_numbers")
      .findOne({ e164: second });
    const customerId = uuid();
    await database.sql().table("customers").insertOne({
      id: customerId,
      name: "Acme West",
      externalId: "acme-west",
    });
    await database.sql().table("number_assignments").insertOne({
      id: uuid(),
      phoneNumberId: number!.id,
      customerId,
      active: true,
    });
    expect(
      (await service([]).listNumbers({ search: "4212" })).items.map(
        (item) => item.e164,
      ),
    ).toEqual([second]);
    expect(
      (await service([]).listNumbers({ customer: "Acme" })).items.map(
        (item) => item.e164,
      ),
    ).toEqual([second]);
    expect(
      (
        await service([]).listNumbers({
          carrier: "mock",
          status: "active",
          pageSize: 1,
          page: 2,
          sort: "e164",
        })
      ).items,
    ).toHaveLength(1);
    expect((await service([]).listNumbers({ carrier: "peerless" })).total).toBe(
      0,
    );
    await expect(service([]).listNumbers({ search: ".*" })).rejects.toThrow(
      "Invalid number search",
    );
  });

  it("serves protected inventory, CSV and XLSX exports, and reconciliation issues", async () => {
    await service([first, second]).sync(accountId);
    await service([first]).sync(accountId);
    const previousUri = process.env.DATABASE_URL;
    const previousSecret = process.env.JWT_SECRET;
    const previousWorker = process.env.DATAPHONE_JOB_WORKER_DISABLED;
    process.env.DATABASE_URL = testUri;
    process.env.JWT_SECRET = "phase6-test-secret-with-at-least-32-bytes";
    process.env.DATAPHONE_JOB_WORKER_DISABLED = "true";
    let app: INestApplication | undefined;
    try {
      app = await createApp();
      await app.listen(0, "127.0.0.1");
      const address = app.getHttpServer().address() as { port: number };
      const root = `http://127.0.0.1:${address.port}/api/v1`;
      expect((await fetch(`${root}/numbers`)).status).toBe(401);
      await bootstrapAdministrator(
        app.get(DatabaseService),
        "inventory-admin@example.test",
        "phase6 secure administrator passphrase",
      );
      const login = await fetch(`${root}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "inventory-admin@example.test",
          password: "phase6 secure administrator passphrase",
        }),
      });
      const { accessToken } = (await login.json()) as { accessToken: string };
      const headers = { Authorization: `Bearer ${accessToken}` };
      const list = await fetch(`${root}/numbers?status=missing`, { headers });
      expect(list.status).toBe(200);
      expect(((await list.json()) as { total: number }).total).toBe(1);
      const detailId = (await database
        .sql()
        .table("phone_numbers")
        .findOne({ e164: second }))!.id;
      const detail = await fetch(`${root}/numbers/${detailId}`, { headers });
      expect(detail.status).toBe(200);
      expect(
        ((await detail.json()) as { holdings: unknown[] }).holdings,
      ).toHaveLength(1);
      const csv = await fetch(`${root}/numbers/export?format=csv`, { headers });
      expect(csv.status).toBe(200);
      expect(await csv.text()).toContain(second);
      const xlsx = await fetch(`${root}/numbers/export?format=xlsx`, {
        headers,
      });
      expect(xlsx.status).toBe(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(
        Buffer.from(await xlsx.arrayBuffer()) as unknown as Parameters<
          typeof workbook.xlsx.load
        >[0],
      );
      expect(
        workbook.getWorksheet("Inventory")?.getRow(2).getCell(1).value,
      ).toBe(second);
      const issues = await fetch(`${root}/reconciliation/issues?status=open`, {
        headers,
      });
      expect(issues.status).toBe(200);
      expect((await issues.json()) as unknown[]).toHaveLength(1);
      const carriers = await fetch(`${root}/carriers`, { headers });
      expect(carriers.status).toBe(200);
      expect(((await carriers.json()) as unknown[]).length).toBeGreaterThan(0);
      const configured = await fetch(`${root}/carriers/${carrierId}/accounts`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          externalAccountId: "new-account",
          credentialRef: "BANDWIDTH_TOKEN",
        }),
      });
      expect(configured.status).toBe(201);
      const configuredBody = (await configured.json()) as { id: string };
      expect(configuredBody.id).toMatch(
        /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/,
      );
      const queued = await fetch(`${root}/carriers/${accountId}/sync`, {
        method: "POST",
        headers,
      });
      expect(queued.status).toBe(201);
      expect(((await queued.json()) as { jobId: string }).jobId).toMatch(
        /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/,
      );
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
