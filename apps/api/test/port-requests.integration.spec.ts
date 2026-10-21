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
import { loadConfig } from "../src/config/app-config";
import { DatabaseService } from "../src/database/database.service";
import { AuditService } from "../src/ownership/audit.service";
import { PortRequests } from "../src/ports/port.requests";

const baseUrl = process.env.DATAPHONE_TEST_DATABASE_URL;
const integration = baseUrl ? describe : describe.skip;

integration("port request drafts", () => {
  let database: DatabaseService;
  let service: PortRequests;
  let customerId: Id;
  let accountId: Id;
  let testUri: string;
  const previousKey = process.env.DATAPHONE_PORT_ENCRYPTION_KEY;

  beforeAll(async () => {
    process.env.DATAPHONE_PORT_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString(
      "base64",
    );
    const url = new URL(
      baseUrl ?? "postgresql://dataphone:dataphone@127.0.0.1:54329/dataphone",
    );
    url.searchParams.set(
      "schema",
      `dataphone_phase9_requests_${randomUUID().replaceAll("-", "")}`,
    );
    testUri = url.toString();
    database = new DatabaseService(
      loadConfig({ DATABASE_URL: url.toString(), NODE_ENV: "test" }),
    );
    await database.ensureReady();
    customerId = uuid();
    accountId = uuid();
    const carrierId = (await database
      .sql()
      .table("carriers")
      .findOne({ code: "bandwidth" }))!.id;
    await database
      .sql()
      .table("customers")
      .insertOne({ id: customerId, name: "Port Buyer", status: "active" });
    await database.sql().table("carrier_accounts").insertOne({
      id: accountId,
      carrierId,
      externalAccountId: "port-fixture",
      status: "active",
    });
    service = new PortRequests(
      database,
      new CarrierRegistry([]) as CarrierRegistryService,
      new AuditService(database),
    );
  });

  afterAll(async () => {
    if (database?.isConnected()) await database.dropTestSchema();
    await database?.close();
    if (previousKey === undefined)
      delete process.env.DATAPHONE_PORT_ENCRYPTION_KEY;
    else process.env.DATAPHONE_PORT_ENCRYPTION_KEY = previousKey;
  });

  it("stores sensitive fields encrypted and returns a redacted draft with history", async () => {
    const actorId = uuid();
    const created = await service.create(
      {
        customerId,
        carrierAccountId: accountId,
        numbers: ["8043024183"],
        currentProvider: "Old Carrier",
        accountName: "Port Buyer",
        accountNumber: "secret-account-123",
        pin: "7788",
        serviceAddress: {
          line1: "1 Main St",
          city: "Richmond",
          region: "VA",
          postalCode: "23220",
        },
      },
      actorId,
    );
    expect(created.status).toBe("DRAFT");
    expect(created.numbers).toEqual(["+18043024183"]);
    expect(JSON.stringify(created)).not.toContain("secret-account-123");
    const raw = await database
      .sql()
      .table("port_requests")
      .findOne({ id: uuid(created.id) });
    expect(JSON.stringify(raw)).not.toContain("secret-account-123");
    expect(JSON.stringify(raw)).not.toContain("7788");
    expect((await service.get(uuid(created.id))).hasAccountNumber).toBe(true);
    expect((await service.list()).items.map((item) => item.id)).toContain(
      created.id,
    );
    expect(
      await database
        .sql()
        .table("port_events")
        .count({ portRequestId: uuid(created.id) }),
    ).toBe(1);
    expect((await new AuditService(database).verify()).valid).toBe(true);
  });

  it("rejects duplicate numbers and unknown customers", async () => {
    const input = {
      customerId,
      carrierAccountId: accountId,
      numbers: ["8043024183", "+18043024183"],
      currentProvider: "Old Carrier",
      accountName: "Port Buyer",
      accountNumber: "secret-account-123",
      pin: "7788",
      serviceAddress: {
        line1: "1 Main St",
        city: "Richmond",
        region: "VA",
        postalCode: "23220",
      },
    };
    await expect(service.create(input, uuid())).rejects.toThrow("distinct");
    await expect(
      service.create(
        { ...input, customerId: uuid(), numbers: ["+18043024184"] },
        uuid(),
      ),
    ).rejects.toThrow("customer");
  });

  it("checks portability through a capable mock carrier account", async () => {
    const mockCarrierId = uuid();
    const mockAccountId = uuid();
    await database.sql().table("carriers").insertOne({
      id: mockCarrierId,
      code: "mock",
      displayName: "Mock",
    });
    await database.sql().table("carrier_accounts").insertOne({
      id: mockAccountId,
      carrierId: mockCarrierId,
      externalAccountId: "portability-fixture",
      status: "active",
    });
    const registry = new CarrierRegistry([
      {
        code: "mock",
        capabilities: new Set(["number.portability"] as const),
        portability: {
          checkPortability: async (_account, number) => ({
            portable: number === "+18043024186",
          }),
        },
      },
    ]);
    const ports = new PortRequests(
      database,
      registry as CarrierRegistryService,
      new AuditService(database),
    );
    expect(
      await ports.checkPortability(mockAccountId, "8043024186"),
    ).toMatchObject({
      e164: "+18043024186",
      portable: true,
      carrier: "mock",
    });
    expect(
      (await ports.checkPortability(mockAccountId, "8043024187")).portable,
    ).toBe(false);
  });

  it("corrects a draft, cancels it locally, and preserves state history", async () => {
    const actorId = uuid();
    const port = await service.create(
      {
        customerId,
        carrierAccountId: accountId,
        numbers: ["+18043024185"],
        currentProvider: "Old Carrier",
        accountName: "Port Buyer",
        accountNumber: "old-secret",
        pin: "1111",
        serviceAddress: {
          line1: "1 Main St",
          city: "Richmond",
          region: "VA",
          postalCode: "23220",
        },
      },
      actorId,
    );
    const id = uuid(port.id);
    const corrected = await service.correct(
      id,
      { accountNumber: "new-secret", pin: "2222" },
      actorId,
    );
    expect(corrected.status).toBe("DRAFT");
    expect(
      JSON.stringify(
        await database.sql().table("port_requests").findOne({ id: id }),
      ),
    ).not.toContain("new-secret");
    expect((await service.cancel(id, actorId)).status).toBe("CANCELLED");
    await expect(service.correct(id, { pin: "3333" }, actorId)).rejects.toThrow(
      "cannot be corrected",
    );
    expect(
      await database.sql().table("port_events").count({ portRequestId: id }),
    ).toBe(3);
    const reopened = await service.create(
      {
        customerId,
        carrierAccountId: accountId,
        numbers: ["+18043024185"],
        currentProvider: "Old Carrier",
        accountName: "Port Buyer",
        accountNumber: "reopened",
        pin: "4444",
        serviceAddress: {
          line1: "1 Main St",
          city: "Richmond",
          region: "VA",
          postalCode: "23220",
        },
      },
      actorId,
    );
    expect(reopened.status).toBe("DRAFT");
  });

  it("protects draft and document endpoints and returns redacted data", async () => {
    const previousUri = process.env.DATABASE_URL;
    const previousSecret = process.env.JWT_SECRET;
    const previousWorker = process.env.DATAPHONE_JOB_WORKER_DISABLED;
    process.env.DATABASE_URL = testUri;
    process.env.JWT_SECRET = "phase9-port-auth-secret-with-at-least-32-bytes";
    process.env.DATAPHONE_JOB_WORKER_DISABLED = "true";
    let app: INestApplication | undefined;
    try {
      app = await createApp();
      await app.listen(0, "127.0.0.1");
      const address = app.getHttpServer().address() as { port: number };
      const root = `http://127.0.0.1:${address.port}/api/v1`;
      expect((await fetch(`${root}/ports`)).status).toBe(401);
      await bootstrapAdministrator(
        app.get(DatabaseService),
        "port-admin@example.test",
        "phase9 secure administrator passphrase",
      );
      const login = await fetch(`${root}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "port-admin@example.test",
          password: "phase9 secure administrator passphrase",
        }),
      });
      const { accessToken } = (await login.json()) as { accessToken: string };
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      };
      const created = await fetch(`${root}/ports`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          customerId: customerId,
          carrierAccountId: accountId,
          numbers: ["+18043024188"],
          currentProvider: "Old Carrier",
          accountName: "Port Buyer",
          accountNumber: "api-secret-account",
          pin: "9999",
          serviceAddress: {
            line1: "1 Main St",
            city: "Richmond",
            region: "VA",
            postalCode: "23220",
          },
        }),
      });
      expect(created.status).toBe(201);
      const port = (await created.json()) as { id: string };
      expect(JSON.stringify(port)).not.toContain("api-secret-account");
      const document = await fetch(`${root}/ports/${port.id}/documents`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          filename: "invoice.pdf",
          contentType: "application/pdf",
          base64: Buffer.from("%PDF-1.7 evidence").toString("base64"),
        }),
      });
      expect(document.status).toBe(201);
      const uploaded = (await document.json()) as { id: string };
      expect(
        (await fetch(`${root}/ports/${port.id}/documents/${uploaded.id}`))
          .status,
      ).toBe(401);
      const downloaded = await fetch(
        `${root}/ports/${port.id}/documents/${uploaded.id}`,
        { headers },
      );
      expect(downloaded.status).toBe(200);
      expect(Buffer.from(await downloaded.arrayBuffer()).toString()).toBe(
        "%PDF-1.7 evidence",
      );
      const largeContent = Buffer.concat([
        Buffer.from("%PDF-1.7\n"),
        Buffer.alloc(700_000, 0x20),
      ]);
      const largeDocument = await fetch(`${root}/ports/${port.id}/documents`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          filename: "large-evidence.pdf",
          contentType: "application/pdf",
          base64: largeContent.toString("base64"),
        }),
      });
      expect(largeDocument.status).toBe(201);
      const largeUploaded = (await largeDocument.json()) as { id: string };
      const largeDownloaded = await fetch(
        `${root}/ports/${port.id}/documents/${largeUploaded.id}`,
        { headers },
      );
      expect(largeDownloaded.status).toBe(200);
      expect(Buffer.from(await largeDownloaded.arrayBuffer())).toEqual(
        largeContent,
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
