import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Id, uuid } from "../database/query";
import { DatabaseService } from "../database/database.service";
import { AuditService } from "../ownership/audit.service";
import { PortCrypto } from "./port.crypto";

export interface PortDocumentRecord {
  id: Id;
  portRequestId: Id;
  fileId: Id;
  filename: string;
  contentType: string;
  byteLength: number;
  createdAt: Date;
}

function view(document: PortDocumentRecord) {
  return {
    id: document.id,
    filename: document.filename,
    contentType: document.contentType,
    byteLength: document.byteLength,
    createdAt: document.createdAt,
  };
}

@Injectable()
export class PortDocuments {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async upload(
    portRequestId: Id,
    filename: string,
    contentType: string,
    content: Buffer,
    actorId: Id,
  ) {
    if (
      typeof filename !== "string" ||
      filename.length < 1 ||
      filename.length > 120 ||
      filename.includes("/") ||
      filename.includes("\\") ||
      Array.from(filename).some((character) => character.charCodeAt(0) < 32)
    )
      throw new BadRequestException("Invalid filename");
    if (!["application/pdf", "image/png", "image/jpeg"].includes(contentType))
      throw new BadRequestException("Unsupported document type");
    if (!content.length || content.length > 5 * 1024 * 1024)
      throw new BadRequestException("Document must be 1 byte to 5 MB");
    const matchesType =
      contentType === "application/pdf"
        ? content.subarray(0, 5).toString("ascii") === "%PDF-"
        : contentType === "image/png"
          ? content
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : content.length >= 4 &&
            content[0] === 0xff &&
            content[1] === 0xd8 &&
            content[2] === 0xff &&
            content.subarray(-2).equals(Buffer.from([0xff, 0xd9]));
    if (!matchesType)
      throw new BadRequestException("Document content does not match its type");
    await this.database.ensureReady();
    const db = this.database.sql();
    const port = await db.table("port_requests").findOne({ id: portRequestId });
    if (!port) throw new NotFoundException("Port request not found");
    const sealed = new PortCrypto().encrypt(content);
    return this.database.withTransaction(async (tx, session) => {
      const fileId = await this.database.uploadDocument(
        `port-${portRequestId}`,
        sealed,
      );
      const record: PortDocumentRecord = {
        id: uuid(),
        portRequestId,
        fileId,
        filename,
        contentType,
        byteLength: content.length,
        createdAt: new Date(),
      };
      await tx
        .table<PortDocumentRecord>("port_documents")
        .insertOne(record, { session });
      await tx.table("port_events").insertOne(
        {
          id: uuid(),
          portRequestId,
          type: "port.document_uploaded",
          actorId,
          previous: null,
          next: {
            documentId: record.id,
            filename,
            byteLength: record.byteLength,
          },
          createdAt: record.createdAt,
        },
        { session },
      );
      await this.audit.append(tx, session, {
        type: "port.document_uploaded",
        actorId,
        customerId: port.customerId as Id | undefined,
        previous: null,
        next: {
          portRequestId: portRequestId,
          documentId: record.id,
        },
      });
      return view(record);
    });
  }

  async list(portRequestId: Id) {
    await this.database.ensureReady();
    const db = this.database.sql();
    if (!(await db.table("port_requests").findOne({ id: portRequestId })))
      throw new NotFoundException("Port request not found");
    return (
      await db
        .table<PortDocumentRecord>("port_documents")
        .find({ portRequestId })
        .sort({ createdAt: -1 })
        .toArray()
    ).map(view);
  }

  async download(portRequestId: Id, documentId: Id) {
    await this.database.ensureReady();
    const record = await this.database
      .sql()
      .table<PortDocumentRecord>("port_documents")
      .findOne({ id: documentId, portRequestId });
    if (!record) throw new NotFoundException("Document not found");
    const sealed = await this.database.downloadDocument(record.fileId);
    return { ...view(record), content: new PortCrypto().decrypt(sealed) };
  }
}
