import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ObjectId } from "mongodb";
import { DatabaseService } from "../database/database.service";
import { AuditService } from "../ownership/audit.service";
import { PortCrypto } from "./port.crypto";

export interface PortDocumentRecord {
  _id: ObjectId;
  portRequestId: ObjectId;
  fileId: ObjectId;
  filename: string;
  contentType: string;
  byteLength: number;
  createdAt: Date;
}

function view(document: PortDocumentRecord) {
  return {
    id: document._id.toHexString(),
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
    portRequestId: ObjectId,
    filename: string,
    contentType: string,
    content: Buffer,
    actorId: ObjectId,
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
    const db = this.database.nativeDb();
    const port = await db
      .collection("port_requests")
      .findOne({ _id: portRequestId });
    if (!port) throw new NotFoundException("Port request not found");
    const sealed = new PortCrypto().encrypt(content);
    const fileId = await this.database.uploadDocument(
      `port-${portRequestId.toHexString()}`,
      sealed,
    );
    try {
      const record: PortDocumentRecord = {
        _id: new ObjectId(),
        portRequestId,
        fileId,
        filename,
        contentType,
        byteLength: content.length,
        createdAt: new Date(),
      };
      await this.database.withTransaction(async (tx, session) => {
        await tx
          .collection<PortDocumentRecord>("port_documents")
          .insertOne(record, { session });
        await tx.collection("port_events").insertOne(
          {
            _id: new ObjectId(),
            portRequestId,
            type: "port.document_uploaded",
            actorId,
            previous: null,
            next: {
              documentId: record._id.toHexString(),
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
          customerId: port.customerId as ObjectId | undefined,
          previous: null,
          next: {
            portRequestId: portRequestId.toHexString(),
            documentId: record._id.toHexString(),
          },
        });
      });
      return view(record);
    } catch (error) {
      await this.database
        .gridFsBucket()
        .delete(fileId)
        .catch(() => undefined);
      throw error;
    }
  }

  async list(portRequestId: ObjectId) {
    await this.database.ensureReady();
    const db = this.database.nativeDb();
    if (!(await db.collection("port_requests").findOne({ _id: portRequestId })))
      throw new NotFoundException("Port request not found");
    return (
      await db
        .collection<PortDocumentRecord>("port_documents")
        .find({ portRequestId })
        .sort({ createdAt: -1 })
        .toArray()
    ).map(view);
  }

  async download(portRequestId: ObjectId, documentId: ObjectId) {
    await this.database.ensureReady();
    const record = await this.database
      .nativeDb()
      .collection<PortDocumentRecord>("port_documents")
      .findOne({ _id: documentId, portRequestId });
    if (!record) throw new NotFoundException("Document not found");
    const sealed = await this.database.downloadDocument(record.fileId);
    return { ...view(record), content: new PortCrypto().decrypt(sealed) };
  }
}
