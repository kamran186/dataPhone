import { createHash } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import { Id, SqlDatabase, SqlSession, uuid } from "../database/query";

import { DatabaseService } from "../database/database.service";

export interface AuditInput {
  type: string;
  actorId: Id;
  customerId?: Id;
  relatedCustomerIds?: Id[];
  phoneNumberId?: Id;
  previous: unknown;
  next: unknown;
}

interface AuditEvent extends AuditInput {
  id: Id;
  sequence: number;
  previousHash: string;
  hash: string;
  createdAt: Date;
}

interface ChainHead {
  id: string;
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

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return canonical(value.toJSON());
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

function digest(event: Omit<AuditEvent, "id" | "hash">): string {
  const payload = {
    sequence: event.sequence,
    type: event.type,
    actorId: event.actorId,
    customerId: event.customerId ?? null,
    relatedCustomerIds: event.relatedCustomerIds?.map((id) => id) ?? null,
    phoneNumberId: event.phoneNumberId ?? null,
    previous: event.previous,
    next: event.next,
    createdAt: event.createdAt.toISOString(),
  };
  return createHash("sha256")
    .update(`${event.previousHash}\n${JSON.stringify(canonical(payload))}`)
    .digest("hex");
}

export async function appendAuditEvent(
  db: SqlDatabase,
  session: SqlSession,
  input: AuditInput,
): Promise<AuditEvent> {
  const heads = db.table<ChainHead>("audit_chain_heads");
  const head = await heads.findOne({ id: "global" }, { session });
  if (!head) throw new Error("Audit chain is not initialized");
  const eventWithoutHash = {
    sequence: head.sequence + 1,
    previousHash: head.hash,
    ...input,
    createdAt: new Date(),
  };
  const event: AuditEvent = {
    id: uuid(),
    ...eventWithoutHash,
    hash: digest(eventWithoutHash),
  };
  const advanced = await heads.updateOne(
    { id: "global", sequence: head.sequence },
    { $set: { sequence: event.sequence, hash: event.hash } },
    { session },
  );
  if (!advanced.matchedCount)
    throw new Error("Audit chain changed during mutation");
  await db.table<AuditEvent>("number_events").insertOne(event, { session });
  return event;
}

@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  async append(
    db: SqlDatabase,
    session: SqlSession,
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
    const db = this.database.sql();
    const events = db
      .table<AuditEvent>("number_events")
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
      .table<ChainHead>("audit_chain_heads")
      .findOne({ id: "global" });
    return {
      valid: head?.sequence === count && head.hash === previousHash,
      count,
    };
  }

  numberHistory(id: Id, filter: HistoryFilter = {}) {
    return this.history({ phoneNumberId: id }, filter);
  }

  customerHistory(id: Id, filter: HistoryFilter = {}) {
    return this.history(
      { $or: [{ customerId: id }, { relatedCustomerIds: id }] },
      filter,
    );
  }

  private async history(
    scope: {
      phoneNumberId?: Id;
      $or?: Array<{ customerId?: Id; relatedCustomerIds?: Id }>;
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
    const collection = this.database.sql().table<AuditEvent>("number_events");
    const [total, events] = await Promise.all([
      collection.count(query),
      collection
        .find(query)
        .sort({ createdAt: -1, sequence: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
    ]);
    return {
      items: events.map((event) => ({
        id: event.id,
        type: event.type,
        actorId: event.actorId,
        customerId: event.customerId,
        relatedCustomerIds: event.relatedCustomerIds?.map((id) => id),
        phoneNumberId: event.phoneNumberId,
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
