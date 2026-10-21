import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseError, Filter, Id, uuid } from "../database/query";
import { CarrierRegistryService } from "../carriers/registry";
import type { CarrierAccount, CarrierCode } from "../carriers/domain";
import { DatabaseService } from "../database/database.service";
import { AuditService } from "../ownership/audit.service";
import { PortCrypto } from "./port.crypto";

export type PortStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "DATE_CONFIRMED"
  | "COMPLETED"
  | "REJECTED"
  | "CANCELLED";
export interface ServiceAddress {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
}
export interface PortDraftInput {
  customerId: Id;
  carrierAccountId: Id;
  numbers: string[];
  currentProvider: string;
  accountName: string;
  accountNumber: string;
  pin: string;
  serviceAddress: ServiceAddress;
}
export interface PortRecord {
  id: Id;
  actorId: Id;
  customerId: Id;
  carrierAccountId: Id;
  numbers: string[];
  currentProvider: string;
  accountName: string;
  accountNumberEncrypted: Buffer;
  pinEncrypted: Buffer;
  serviceAddress: ServiceAddress;
  status: PortStatus;
  version: number;
  nativeOrderId?: string;
  nativeStatus?: string;
  focDate?: Date;
  rejectionReason?: string;
  jobId?: Id;
  unfulfilledCount?: number;
  createdAt: Date;
  updatedAt: Date;
}
interface PortEvent {
  id: Id;
  portRequestId: Id;
  type: string;
  actorId: Id;
  previous: unknown;
  next: unknown;
  createdAt: Date;
}

function normalize(raw: string): string {
  if (typeof raw !== "string")
    throw new BadRequestException("Invalid port number");
  const digits = raw.replace(/[().\s-]/g, "");
  const result = /^\d{10}$/.test(digits)
    ? `+1${digits}`
    : /^1\d{10}$/.test(digits)
      ? `+${digits}`
      : digits;
  if (!/^\+[1-9]\d{1,14}$/.test(result))
    throw new BadRequestException("Invalid port number");
  return result;
}
function required(raw: string, label: string, max = 120): string {
  if (typeof raw !== "string" || !raw.trim() || raw.trim().length > max)
    throw new BadRequestException(`Invalid ${label}`);
  return raw.trim();
}
function validateAddress(raw: ServiceAddress): ServiceAddress {
  if (!raw || typeof raw !== "object")
    throw new BadRequestException("Invalid service address");
  const region = required(raw.region, "state", 2).toUpperCase();
  const postalCode = required(raw.postalCode, "postal code", 10);
  if (!/^[A-Z]{2}$/.test(region) || !/^\d{5}(?:-\d{4})?$/.test(postalCode))
    throw new BadRequestException("Invalid service address");
  return {
    line1: required(raw.line1, "address"),
    ...(raw.line2?.trim()
      ? { line2: required(raw.line2, "address line 2") }
      : {}),
    city: required(raw.city, "city", 80),
    region,
    postalCode,
  };
}
export function portView(record: PortRecord) {
  return {
    id: record.id,
    customerId: record.customerId,
    carrierAccountId: record.carrierAccountId,
    numbers: record.numbers,
    currentProvider: record.currentProvider,
    accountName: record.accountName,
    hasAccountNumber: Boolean(record.accountNumberEncrypted?.length),
    hasPin: Boolean(record.pinEncrypted?.length),
    serviceAddress: record.serviceAddress,
    status: record.status,
    version: record.version,
    nativeOrderId: record.nativeOrderId,
    nativeStatus: record.nativeStatus,
    focDate: record.focDate,
    rejectionReason: record.rejectionReason,
    jobId: record.jobId,
    unfulfilledCount: record.unfulfilledCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

@Injectable()
export class PortRequests {
  constructor(
    private readonly database: DatabaseService,
    private readonly carriers: CarrierRegistryService,
    private readonly audit: AuditService,
  ) {}

  async checkPortability(carrierAccountId: Id, rawNumber: string) {
    const number = normalize(rawNumber);
    await this.database.ensureReady();
    const db = this.database.sql();
    const account = await db
      .table<{
        id: Id;
        carrierId: Id;
        externalAccountId: string;
        credentialRef?: string;
        status: string;
      }>("carrier_accounts")
      .findOne({ id: carrierAccountId, status: "active" });
    if (!account)
      throw new NotFoundException("Active carrier account not found");
    const carrier = await db
      .table<{ id: Id; code: CarrierCode }>("carriers")
      .findOne({ id: account.carrierId });
    if (!carrier) throw new NotFoundException("Carrier not found");
    if (
      !this.carriers.capabilities(carrier.code).includes("number.portability")
    )
      throw new ConflictException(
        "Carrier portability checking is unavailable",
      );
    const reference: CarrierAccount = {
      id: account.id,
      carrier: carrier.code,
      nativeAccountId: account.externalAccountId,
      credentialRef: account.credentialRef,
    };
    const result = await this.carriers
      .portability(reference)
      .checkPortability(reference, number);
    return {
      e164: number,
      portable: result.portable,
      carrier: carrier.code,
      carrierAccountId: carrierAccountId,
    };
  }

  async create(input: PortDraftInput, actorId: Id) {
    if (
      !Array.isArray(input.numbers) ||
      input.numbers.length < 1 ||
      input.numbers.length > 100
    )
      throw new BadRequestException("Provide 1 to 100 port numbers");
    const numbers = input.numbers.map(normalize);
    if (new Set(numbers).size !== numbers.length)
      throw new BadRequestException("Provide distinct port numbers");
    const currentProvider = required(input.currentProvider, "current provider");
    const accountName = required(input.accountName, "account name");
    const serviceAddress = validateAddress(input.serviceAddress);
    const crypto = new PortCrypto();
    const accountNumberEncrypted = crypto.encrypt(
      Buffer.from(required(input.accountNumber, "account number", 128)),
    );
    const pinEncrypted = crypto.encrypt(
      Buffer.from(required(input.pin, "PIN", 64)),
    );
    await this.database.ensureReady();
    const db = this.database.sql();
    if (
      !(await db
        .table("customers")
        .findOne({ id: input.customerId, status: "active" }))
    )
      throw new NotFoundException("Active customer not found");
    if (
      !(await db
        .table("carrier_accounts")
        .findOne({ id: input.carrierAccountId, status: "active" }))
    )
      throw new NotFoundException("Active carrier account not found");
    const overlap = await db.table("port_requests").findOne({
      numbers: { $in: numbers },
      status: { $in: ["DRAFT", "SUBMITTED", "DATE_CONFIRMED", "REJECTED"] },
    });
    if (overlap)
      throw new ConflictException("A number already has an open port request");
    try {
      return await this.database.withTransaction(async (tx, session) => {
        const now = new Date();
        const record: PortRecord = {
          id: uuid(),
          actorId,
          customerId: input.customerId,
          carrierAccountId: input.carrierAccountId,
          numbers,
          currentProvider,
          accountName,
          accountNumberEncrypted,
          pinEncrypted,
          serviceAddress,
          status: "DRAFT",
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        await tx
          .table<PortRecord>("port_requests")
          .insertOne(record, { session });
        await tx.table("port_request_numbers").insertMany(
          numbers.map((e164) => ({
            id: uuid(),
            portRequestId: record.id,
            e164,
            status: "DRAFT",
            createdAt: now,
          })),
          { session },
        );
        await tx.table<PortEvent>("port_events").insertOne(
          {
            id: uuid(),
            portRequestId: record.id,
            type: "port.created",
            actorId,
            previous: null,
            next: { status: "DRAFT", numbers },
            createdAt: now,
          },
          { session },
        );
        await this.audit.append(tx, session, {
          type: "port.created",
          actorId,
          customerId: input.customerId,
          previous: null,
          next: { portRequestId: record.id, numbers },
        });
        return portView(record);
      });
    } catch (error) {
      if (error instanceof DatabaseError && error.code === "23505")
        throw new ConflictException(
          "A number already has an open port request",
        );
      throw error;
    }
  }

  async get(id: Id) {
    await this.database.ensureReady();
    const record = await this.database
      .sql()
      .table<PortRecord>("port_requests")
      .findOne({ id: id });
    if (!record) throw new NotFoundException("Port request not found");
    const events = await this.database
      .sql()
      .table<PortEvent>("port_events")
      .find({ portRequestId: id })
      .sort({ createdAt: 1 })
      .toArray();
    return {
      ...portView(record),
      history: events.map((event) => ({
        id: event.id,
        type: event.type,
        actorId: event.actorId,
        previous: event.previous,
        next: event.next,
        createdAt: event.createdAt,
      })),
    };
  }

  async list(status?: PortStatus, page = 1, pageSize = 25) {
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 10_000 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      throw new BadRequestException("Invalid port page");
    await this.database.ensureReady();
    const query: Filter<PortRecord> = status
      ? { status }
      : {
          status: { $in: ["DRAFT", "SUBMITTED", "DATE_CONFIRMED", "REJECTED"] },
        };
    const collection = this.database.sql().table<PortRecord>("port_requests");
    const [total, rows] = await Promise.all([
      collection.count(query),
      collection
        .find(query)
        .sort({ updatedAt: -1, id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
    ]);
    return { items: rows.map(portView), total, page, pageSize };
  }

  async correct(
    id: Id,
    changes: Partial<
      Pick<
        PortDraftInput,
        | "currentProvider"
        | "accountName"
        | "accountNumber"
        | "pin"
        | "serviceAddress"
      >
    >,
    actorId: Id,
  ) {
    const fields = Object.keys(changes);
    if (
      !fields.length ||
      fields.some(
        (key) =>
          ![
            "currentProvider",
            "accountName",
            "accountNumber",
            "pin",
            "serviceAddress",
          ].includes(key),
      )
    )
      throw new BadRequestException("Invalid port correction");
    await this.database.ensureReady();
    const crypto = new PortCrypto();
    return this.database.withTransaction(async (tx, session) => {
      const collection = tx.table<PortRecord>("port_requests");
      const current = await collection.findOne({ id: id }, { session });
      if (!current) throw new NotFoundException("Port request not found");
      if (!["DRAFT", "REJECTED"].includes(current.status))
        throw new ConflictException(
          "Port request cannot be corrected in its current state",
        );
      const next: PortRecord = {
        ...current,
        ...(changes.currentProvider !== undefined
          ? {
              currentProvider: required(
                changes.currentProvider,
                "current provider",
              ),
            }
          : {}),
        ...(changes.accountName !== undefined
          ? { accountName: required(changes.accountName, "account name") }
          : {}),
        ...(changes.accountNumber !== undefined
          ? {
              accountNumberEncrypted: crypto.encrypt(
                Buffer.from(
                  required(changes.accountNumber, "account number", 128),
                ),
              ),
            }
          : {}),
        ...(changes.pin !== undefined
          ? {
              pinEncrypted: crypto.encrypt(
                Buffer.from(required(changes.pin, "PIN", 64)),
              ),
            }
          : {}),
        ...(changes.serviceAddress !== undefined
          ? { serviceAddress: validateAddress(changes.serviceAddress) }
          : {}),
        status: "DRAFT",
        version: current.version + 1,
        updatedAt: new Date(),
        rejectionReason: undefined,
      };
      const updated = await collection.replaceOne(
        { id: id, version: current.version },
        next,
        { session },
      );
      if (!updated.matchedCount)
        throw new ConflictException("Port request changed");
      await tx.table<PortEvent>("port_events").insertOne(
        {
          id: uuid(),
          portRequestId: id,
          type: "port.corrected",
          actorId,
          previous: { status: current.status, version: current.version },
          next: { status: "DRAFT", version: next.version, fields },
          createdAt: next.updatedAt,
        },
        { session },
      );
      await this.audit.append(tx, session, {
        type: "port.corrected",
        actorId,
        customerId: current.customerId,
        previous: { status: current.status, version: current.version },
        next: {
          portRequestId: id,
          status: "DRAFT",
          version: next.version,
        },
      });
      return portView(next);
    });
  }

  async cancel(id: Id, actorId: Id) {
    await this.database.ensureReady();
    return this.database.withTransaction(async (tx, session) => {
      const collection = tx.table<PortRecord>("port_requests");
      const current = await collection.findOne({ id: id }, { session });
      if (!current) throw new NotFoundException("Port request not found");
      if (current.status === "CANCELLED") return portView(current);
      if (!["DRAFT", "REJECTED"].includes(current.status))
        throw new ConflictException(
          "Submitted ports require carrier cancellation capability",
        );
      const now = new Date();
      const updated = await collection.updateOne(
        { id: id, version: current.version },
        { $set: { status: "CANCELLED", updatedAt: now }, $inc: { version: 1 } },
        { session },
      );
      if (!updated.matchedCount)
        throw new ConflictException("Port request changed");
      await tx
        .table("port_request_numbers")
        .updateMany(
          { portRequestId: id },
          { $set: { status: "CANCELLED" } },
          { session },
        );
      await tx.table<PortEvent>("port_events").insertOne(
        {
          id: uuid(),
          portRequestId: id,
          type: "port.cancelled",
          actorId,
          previous: { status: current.status },
          next: { status: "CANCELLED" },
          createdAt: now,
        },
        { session },
      );
      await this.audit.append(tx, session, {
        type: "port.cancelled",
        actorId,
        customerId: current.customerId,
        previous: { status: current.status },
        next: { portRequestId: id, status: "CANCELLED" },
      });
      return portView({
        ...current,
        status: "CANCELLED",
        version: current.version + 1,
        updatedAt: now,
      });
    });
  }
}
