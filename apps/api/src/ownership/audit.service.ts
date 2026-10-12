import { createHash } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import type { ClientSession, Db } from "mongodb";
import { ObjectId } from "mongodb";
import { DatabaseService } from "../database/database.service";

export interface AuditInput {
  type: string;
  actorId: ObjectId;
  customerId?: ObjectId;
  relatedCustomerIds?: ObjectId[];
  phoneNumberId?: ObjectId;
  previous: unknown;
  next: unknown;
}

interface AuditEvent extends AuditInput {
  _id: ObjectId;
  sequence: number;
  previousHash: string;
  hash: string;
  createdAt: Date;
}

interface ChainHead {
  _id: string;
  sequence: number;
  hash: string;
}

export interface HistoryFilter {
  type?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

const GENESIS_HASH = "0".repeat(64);

function digest(event: Omit<AuditEvent, "_id" | "hash">): string {
  const payload = {
    sequence: event.sequence,
    type: event.type,
    actorId: event.actorId.toHexString(),
    customerId: event.customerId?.toHexString() ?? null,
    relatedCustomerIds:
      event.relatedCustomerIds?.map((id) => id.toHexString()) ?? null,
    phoneNumberId: event.phoneNumberId?.toHexString() ?? null,
    previous: event.previous,
    next: event.next,
    createdAt: event.createdAt.toISOString(),
  };
  return createHash("sha256")
    .update(`${event.previousHash}\n${JSON.stringify(payload)}`)
    .digest("hex");
}

export async function appendAuditEvent(
  db: Db,
  session: ClientSession,
  input: AuditInput,
): Promise<AuditEvent> {
  const heads = db.collection<ChainHead>("audit_chain_heads");
  const head = await heads.findOne({ _id: "global" }, { session });
  if (!head) throw new Error("Audit chain is not initialized");
  const eventWithoutHash = {
    sequence: head.sequence + 1,
    previousHash: head.hash,
    ...input,
    createdAt: new Date(),
  };
  const event: AuditEvent = {
    _id: new ObjectId(),
    ...eventWithoutHash,
    hash: digest(eventWithoutHash),
  };
  const advanced = await heads.updateOne(
    { _id: "global", sequence: head.sequence },
    { $set: { sequence: event.sequence, hash: event.hash } },
    { session },
  );
  if (!advanced.matchedCount)
    throw new Error("Audit chain changed during mutation");
  await db
    .collection<AuditEvent>("number_events")
    .insertOne(event, { session });
  return event;
}

@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  async append(
    db: Db,
    session: ClientSession,
    input: AuditInput,
  ): Promise<AuditEvent> {
    return appendAuditEvent(db, session, input);
  }

  async verify(): Promise<{
    valid: boolean;
    count: number;
    failedSequence?: number;
  }> {
    await this.database.ensureReady();
    const db = this.database.nativeDb();
    const events = db
      .collection<AuditEvent>("number_events")
      .find({ sequence: { $exists: true } })
      .sort({ sequence: 1 });
    let previousHash = GENESIS_HASH;
    let count = 0;
    for await (const event of events) {
      count += 1;
      if (
        event.sequence !== count ||
        event.previousHash !== previousHash ||
        digest(event) !== event.hash
      )
        return { valid: false, count, failedSequence: event.sequence };
      previousHash = event.hash;
    }
    const head = await db
      .collection<ChainHead>("audit_chain_heads")
      .findOne({ _id: "global" });
    return {
      valid: head?.sequence === count && head.hash === previousHash,
      count,
    };
  }

  numberHistory(id: ObjectId, filter: HistoryFilter = {}) {
    return this.history({ phoneNumberId: id }, filter);
  }

  customerHistory(id: ObjectId, filter: HistoryFilter = {}) {
    return this.history(
      { $or: [{ customerId: id }, { relatedCustomerIds: id }] },
      filter,
    );
  }

  private async history(
    scope: {
      phoneNumberId?: ObjectId;
      $or?: Array<{ customerId?: ObjectId; relatedCustomerIds?: ObjectId }>;
    },
    filter: HistoryFilter,
  ) {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 25;
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 10_000 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      throw new BadRequestException("Invalid history page");
    if (filter.type && !/^[a-z]+\.[a-z_]{1,48}$/.test(filter.type))
      throw new BadRequestException("Invalid history type");
    const datePattern =
      /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/;
    if (
      (filter.from && !datePattern.test(filter.from)) ||
      (filter.to && !datePattern.test(filter.to))
    )
      throw new BadRequestException("Invalid history date");
    const from = filter.from === undefined ? undefined : new Date(filter.from);
    const to =
      filter.to === undefined
        ? undefined
        : new Date(
            /^\d{4}-\d{2}-\d{2}$/.test(filter.to)
              ? `${filter.to}T23:59:59.999Z`
              : filter.to,
          );
    if (
      (from && Number.isNaN(from.getTime())) ||
      (to && Number.isNaN(to.getTime())) ||
      (from && to && from > to)
    )
      throw new BadRequestException("Invalid history date");
    await this.database.ensureReady();
    const query = {
      ...scope,
      ...(filter.type ? { type: filter.type } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { $gte: from } : {}),
              ...(to ? { $lte: to } : {}),
            },
          }
        : {}),
    };
    const collection = this.database
      .nativeDb()
      .collection<AuditEvent>("number_events");
    const [total, events] = await Promise.all([
      collection.countDocuments(query),
      collection
        .find(query)
        .sort({ createdAt: -1, sequence: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
    ]);
    return {
      items: events.map((event) => ({
        id: event._id.toHexString(),
        type: event.type,
        actorId: event.actorId.toHexString(),
        customerId: event.customerId?.toHexString(),
        relatedCustomerIds: event.relatedCustomerIds?.map((id) =>
          id.toHexString(),
        ),
        phoneNumberId: event.phoneNumberId?.toHexString(),
        previous: event.previous,
        next: event.next,
        createdAt: event.createdAt,
        sequence: event.sequence,
        previousHash: event.previousHash,
        hash: event.hash,
      })),
      total,
      page,
      pageSize,
    };
  }
}
