import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { loadConfig } from "../src/config/app-config";
import { DatabaseService } from "../src/database/database.service";
import { PortDocuments } from "../src/ports/port.documents";

const baseUrl = process.env.DATAPHONE_TEST_MONGO_URL;
const integration = baseUrl ? describe : describe.skip;

integration("encrypted port documents", () => {
  let database: DatabaseService;
  let portId: ObjectId;
  const previousKey = process.env.DATAPHONE_PORT_ENCRYPTION_KEY;

  beforeAll(async () => {
    process.env.DATAPHONE_PORT_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString(
      "base64",
    );
    const url = new URL(baseUrl ?? "mongodb://127.0.0.1:27017/");
    url.pathname = `/dataphone_phase9_documents_${randomUUID().replaceAll("-", "")}`;
    database = new DatabaseService(
      loadConfig({ MONGO_URI: url.toString(), NODE_ENV: "test" }),
    );
    await database.ensureReady();
    portId = new ObjectId();
    await database
      .nativeDb()
      .collection("port_requests")
      .insertOne({ _id: portId, status: "DRAFT" });
  });

  afterAll(async () => {
    if (database?.isConnected()) await database.nativeDb().dropDatabase();
    await database?.close();
    if (previousKey === undefined)
      delete process.env.DATAPHONE_PORT_ENCRYPTION_KEY;
    else process.env.DATAPHONE_PORT_ENCRYPTION_KEY = previousKey;
  });

  it("stores only encrypted bytes and rejects cross-port document access", async () => {
    const service = new PortDocuments(database);
    const plain = Buffer.from("%PDF-1.7 sensitive account evidence");
    const uploaded = await service.upload(
      portId,
      "invoice.pdf",
      "application/pdf",
      plain,
    );
    expect((await service.list(portId)).map((item) => item.id)).toContain(
      uploaded.id,
    );
    const metadata = await database
      .nativeDb()
      .collection("port_documents")
      .findOne({ _id: new ObjectId(uploaded.id) });
    const stored = await database.downloadDocument(metadata!.fileId);
    expect(stored.includes(plain)).toBe(false);
    expect(
      (await service.download(portId, new ObjectId(uploaded.id))).content,
    ).toEqual(plain);
    await expect(
      service.download(new ObjectId(), new ObjectId(uploaded.id)),
    ).rejects.toThrow("Document not found");
    await expect(
      service.upload(portId, "bad.exe", "application/octet-stream", plain),
    ).rejects.toThrow("Unsupported");
  });
});
