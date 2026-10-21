import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseError, Id, uuid } from "../database/query";
import { DatabaseService } from "../database/database.service";
import type { CustomerRecord } from "../database/entities";
import { AuditService } from "./audit.service";

function view(customer: CustomerRecord) {
  return {
    id: customer.id,
    externalId: customer.externalId,
    name: customer.name,
    status: customer.status,
    version: customer.version,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

function page(input: { page?: number; pageSize?: number }) {
  const current = input.page ?? 1;
  const pageSize = input.pageSize ?? 25;
  if (
    !Number.isInteger(current) ||
    current < 1 ||
    current > 10_000 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    throw new BadRequestException("Invalid page");
  return { page: current, pageSize };
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(input: { search?: string; page?: number; pageSize?: number }) {
    const { page: current, pageSize } = page(input);
    await this.database.ensureReady();
    const search = input.search?.trim();
    if (search && (search.length < 2 || search.length > 100))
      throw new BadRequestException("Invalid customer search");
    const escaped = search?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const filter = escaped ? { name: { $regex: escaped, $options: "i" } } : {};
    const collection = this.database.sql().table<CustomerRecord>("customers");
    const [total, items] = await Promise.all([
      collection.count(filter),
      collection
        .find(filter)
        .sort({ name: 1, id: 1 })
        .skip((current - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
    ]);
    return { items: items.map(view), total, page: current, pageSize };
  }

  async get(id: Id) {
    await this.database.ensureReady();
    const customer = await this.database
      .sql()
      .table<CustomerRecord>("customers")
      .findOne({ id: id });
    if (!customer) throw new NotFoundException("Customer not found");
    return view(customer);
  }

  async numbers(id: Id, input: { page?: number; pageSize?: number }) {
    const { page: current, pageSize } = page(input);
    await this.get(id);
    const db = this.database.sql();
    const assignments = db.table("number_assignments");
    const filter = { customerId: id, active: true };
    const [total, entries] = await Promise.all([
      assignments.count(filter),
      assignments
        .find(filter)
        .sort({ id: 1 })
        .skip((current - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
    ]);
    const numbers = await db
      .table("phone_numbers")
      .find({
        id: { $in: entries.map((entry) => entry.phoneNumberId as Id) },
      })
      .toArray();
    const byId = new Map(numbers.map((number) => [number.id, number]));
    return {
      items: entries.flatMap((entry) => {
        const number = byId.get(entry.phoneNumberId as Id);
        return number
          ? [
              {
                id: number.id,
                e164: number.e164 as string,
                status: number.status as string,
                startedAt: entry.startedAt as Date | undefined,
              },
            ]
          : [];
      }),
      total,
      page: current,
      pageSize,
    };
  }

  async create(input: { externalId: string; name: string }, actorId: Id) {
    const externalId = input.externalId?.trim();
    const name = input.name?.trim();
    if (!externalId || !/^[A-Za-z0-9_-]{1,64}$/.test(externalId))
      throw new BadRequestException("Invalid external customer ID");
    if (!name || name.length < 2 || name.length > 100)
      throw new BadRequestException("Invalid customer name");
    await this.database.ensureReady();
    try {
      const customer = await this.database.withTransaction(
        async (db, session) => {
          const now = new Date();
          const record: CustomerRecord = {
            id: uuid(),
            externalId,
            name,
            status: "active",
            version: 1,
            createdAt: now,
            updatedAt: now,
          };
          await db
            .table<CustomerRecord>("customers")
            .insertOne(record, { session });
          await this.audit.append(db, session, {
            type: "customer.created",
            actorId,
            customerId: record.id,
            previous: null,
            next: { externalId, name, status: "active" },
          });
          return record;
        },
      );
      return view(customer);
    } catch (error) {
      if (error instanceof DatabaseError && error.code === "23505")
        throw new ConflictException("Customer external ID already exists");
      throw error;
    }
  }

  async update(
    id: Id,
    input: { name?: string; status?: "active" | "inactive"; version: number },
    actorId: Id,
  ) {
    if (!Number.isInteger(input.version) || input.version < 1)
      throw new BadRequestException("Invalid customer version");
    if (
      input.name !== undefined &&
      (input.name.trim().length < 2 || input.name.trim().length > 100)
    )
      throw new BadRequestException("Invalid customer name");
    if (
      input.status !== undefined &&
      !["active", "inactive"].includes(input.status)
    )
      throw new BadRequestException("Invalid customer status");
    if (input.name === undefined && input.status === undefined)
      throw new BadRequestException("No customer changes supplied");
    await this.database.ensureReady();
    const result = await this.database.withTransaction(async (db, session) => {
      const collection = db.table<CustomerRecord>("customers");
      const current = await collection.findOne({ id: id }, { session });
      if (!current) throw new NotFoundException("Customer not found");
      if (current.version !== input.version)
        throw new ConflictException("Customer changed since it was loaded");
      const next: CustomerRecord = {
        ...current,
        name: input.name?.trim() ?? current.name,
        status: input.status ?? current.status,
        version: current.version + 1,
        updatedAt: new Date(),
      };
      const changed = await collection.updateOne(
        { id: id, version: input.version },
        {
          $set: {
            name: next.name,
            status: next.status,
            version: next.version,
            updatedAt: next.updatedAt,
          },
        },
        { session },
      );
      if (!changed.matchedCount)
        throw new ConflictException("Customer changed since it was loaded");
      await this.audit.append(db, session, {
        type: "customer.updated",
        actorId,
        customerId: id,
        previous: { name: current.name, status: current.status },
        next: { name: next.name, status: next.status },
      });
      return next;
    });
    return view(result);
  }
}
