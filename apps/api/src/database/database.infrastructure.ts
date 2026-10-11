import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  ClientSession,
  Db,
  GridFSBucket,
  MongoClient,
  ObjectId,
} from "mongodb";
import { DataSource, MongoRepository, ObjectLiteral } from "typeorm";
import { coreEntities } from "./entities";
import { initializeCoreSchema } from "./schema";

export class ConcurrencyConflictError extends Error {
  constructor() {
    super("Record was changed by another operation");
    this.name = "ConcurrencyConflictError";
  }
}

const appendOnlyCollections = new Set([
  "number_events",
  "job_events",
  "security_audit_events",
  "port_events",
]);

export class DatabaseInfrastructure {
  private readonly source: DataSource;
  private readonly client: MongoClient;
  private readonly databaseName: string;

  constructor(uri: string) {
    const parsed = new URL(uri);
    this.databaseName = decodeURIComponent(parsed.pathname.slice(1));
    if (!this.databaseName)
      throw new Error("MongoDB database name is required");
    this.source = new DataSource({
      type: "mongodb",
      url: uri,
      database: this.databaseName,
      entities: coreEntities,
      synchronize: false,
    });
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 1000 });
  }

  async connect(): Promise<void> {
    await this.source.initialize();
    try {
      await this.client.connect();
    } catch (error) {
      await this.source.destroy();
      throw error;
    }
  }

  isConnected(): boolean {
    return this.source.isInitialized;
  }

  repository<T extends ObjectLiteral>(entity: string): MongoRepository<T> {
    return this.source.getMongoRepository<T>(entity);
  }

  nativeDb(): Db {
    return this.client.db(this.databaseName);
  }

  async initializeSchema(): Promise<void> {
    await initializeCoreSchema(this.nativeDb());
  }

  async withTransaction<T>(
    work: (db: Db, session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = this.client.startSession();
    try {
      return await session.withTransaction(() =>
        work(this.nativeDb(), session),
      );
    } finally {
      await session.endSession();
    }
  }

  async updateWithVersion(
    collectionName: string,
    id: ObjectId,
    expectedVersion: number,
    fields: Record<string, unknown>,
  ): Promise<void> {
    if (appendOnlyCollections.has(collectionName)) {
      throw new Error(`${collectionName} is append-only`);
    }
    if ("_id" in fields || "version" in fields || "updatedAt" in fields)
      throw new Error("Immutable or managed field cannot be updated");
    const result = await this.nativeDb()
      .collection(collectionName)
      .updateOne(
        { _id: id, version: expectedVersion },
        {
          $set: fields,
          $inc: { version: 1 },
          $currentDate: { updatedAt: true },
        },
      );
    if (result.matchedCount !== 1) throw new ConcurrencyConflictError();
  }

  gridFsBucket(): GridFSBucket {
    return new GridFSBucket(this.nativeDb(), { bucketName: "documents" });
  }

  async uploadDocument(filename: string, content: Buffer): Promise<ObjectId> {
    const stream = this.gridFsBucket().openUploadStream(filename);
    await pipeline(Readable.from([content]), stream);
    return stream.id;
  }

  async downloadDocument(id: ObjectId): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of this.gridFsBucket().openDownloadStream(id)) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async ping(): Promise<void> {
    await this.nativeDb().command({ ping: 1 });
  }

  async close(): Promise<void> {
    await this.client.close();
    if (this.source.isInitialized) await this.source.destroy();
  }
}
