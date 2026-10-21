import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Id, uuid } from "../src/database/query";
import { loadConfig } from "../src/config/app-config";
import { DatabaseService } from "../src/database/database.service";
import { PortDocuments } from "../src/ports/port.documents";
import { AuditService } from "../src/ownership/audit.service";

const baseUrl = process.env.DATAPHONE_TEST_DATABASE_URL;
const integration = baseUrl ? describe : describe.skip;

integration("encrypted port documents", () => {
  let database: DatabaseService;
  let portId: Id;
  const previousKey = process.env.DATAPHONE_PORT_ENCRYPTION_KEY;

  beforeAll(async () => {
    process.env.DATAPHONE_PORT_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString(
      "base64",
    );
    const url = new URL(
      baseUrl ?? "postgresql://dataphone:dataphone@127.0.0.1:54329/dataphone",
    );
    url.searchParams.set(
      "schema",
      `dataphone_phase9_documents_${randomUUID().replaceAll("-", "")}`,
    );
    database = new DatabaseService(
      loadConfig({ DATABASE_URL: url.toString(), NODE_ENV: "test" }),
    );
    await database.ensureReady();
    portId = uuid();
    await database
      .sql()
      .table("port_requests")
      .insertOne({ id: portId, status: "DRAFT" });
  });

  afterAll(async () => {
    if (database?.isConnected()) await database.dropTestSchema();
    await database?.close();
    if (previousKey === undefined)
      delete process.env.DATAPHONE_PORT_ENCRYPTION_KEY;
    else process.env.DATAPHONE_PORT_ENCRYPTION_KEY = previousKey;
  });

  it("stores only encrypted bytes and rejects cross-port document access", async () => {
    const service = new PortDocuments(database, new AuditService(database));
    const plain = Buffer.from("%PDF-1.7 sensitive account evidence");
    const uploaded = await service.upload(
      portId,
      "invoice.pdf",
      "application/pdf",
      plain,
      uuid(),
    );
    expect((await service.list(portId)).map((item) => item.id)).toContain(
      uploaded.id,
    );
    const metadata = await database
      .sql()
      .table("port_documents")
      .findOne({ id: uuid(uploaded.id) });
    const stored = await database.downloadDocument(metadata!.fileId);
    expect(stored.includes(plain)).toBe(false);
    expect(await new AuditService(database).verify()).toMatchObject({
      valid: true,
      count: 1,
    });
    expect(
      await database.sql().table("port_events").count({
        portRequestId: portId,
        type: "port.document_uploaded",
      }),
    ).toBe(1);
    expect((await service.download(portId, uuid(uploaded.id))).content).toEqual(
      plain,
    );
    await expect(service.download(uuid(), uuid(uploaded.id))).rejects.toThrow(
      "Document not found",
    );
    await expect(
      service.upload(
        portId,
        "bad.exe",
        "application/octet-stream",
        plain,
        uuid(),
      ),
    ).rejects.toThrow("Unsupported");
  });
});
