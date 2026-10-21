import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DatabaseError,
  Id,
  SqlDatabase,
  SqlSession,
  uuid,
} from "../database/query";
import { DatabaseService } from "../database/database.service";
import { AuditService } from "./audit.service";

interface AssignmentRecord {
  id: Id;
  phoneNumberId: Id;
  customerId: Id;
  active: boolean;
  startedAt: Date;
  endedAt?: Date;
  createdAt: Date;
}

function view(record: AssignmentRecord) {
  return {
    id: record.id,
    numberId: record.phoneNumberId,
    customerId: record.customerId,
    active: record.active,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
  };
}

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async assign(numberId: Id, customerId: Id, actorId: Id) {
    await this.database.ensureReady();
    return this.conflicts(async () =>
      view(
        await this.database.withTransaction((db, session) =>
          this.assignInTransaction(db, session, numberId, customerId, actorId),
        ),
      ),
    );
  }

  async bulk(numberIds: Id[], customerId: Id, actorId: Id) {
    if (
      !Array.isArray(numberIds) ||
      numberIds.length < 1 ||
      numberIds.length > 100 ||
      new Set(numberIds.map((id) => id)).size !== numberIds.length
    )
      throw new BadRequestException(
        "Bulk assignment requires 1 to 100 distinct numbers",
      );
    await this.database.ensureReady();
    return this.conflicts(async () =>
      this.database.withTransaction(async (db, session) => {
        const results = [];
        for (const numberId of numberIds)
          results.push(
            view(
              await this.assignInTransaction(
                db,
                session,
                numberId,
                customerId,
                actorId,
              ),
            ),
          );
        return results;
      }),
    );
  }

  async transfer(numberId: Id, customerId: Id, actorId: Id) {
    await this.database.ensureReady();
    return this.conflicts(async () =>
      view(
        await this.database.withTransaction(async (db, session) => {
          await this.requireCustomer(db, session, customerId);
          const current = await db
            .table<AssignmentRecord>("number_assignments")
            .findOne({ phoneNumberId: numberId, active: true }, { session });
          if (!current) throw new ConflictException("Number is not assigned");
          if (current.customerId === customerId)
            throw new ConflictException(
              "Number is already assigned to this customer",
            );
          const now = new Date();
          const closed = await db
            .table<AssignmentRecord>("number_assignments")
            .updateOne(
              { id: current.id, active: true },
              { $set: { active: false, endedAt: now } },
              { session },
            );
          if (!closed.matchedCount)
            throw new ConflictException("Number assignment changed");
          const next: AssignmentRecord = {
            id: uuid(),
            phoneNumberId: numberId,
            customerId,
            active: true,
            startedAt: now,
            createdAt: now,
          };
          await db
            .table<AssignmentRecord>("number_assignments")
            .insertOne(next, { session });
          await this.audit.append(db, session, {
            type: "number.transferred",
            actorId,
            phoneNumberId: numberId,
            customerId,
            relatedCustomerIds: [current.customerId],
            previous: { customerId: current.customerId },
            next: { customerId: customerId },
          });
          return next;
        }),
      ),
    );
  }

  async unassign(numberId: Id, actorId: Id) {
    await this.database.ensureReady();
    return this.conflicts(async () =>
      this.database.withTransaction((db, session) =>
        this.unassignInTransaction(db, session, numberId, actorId),
      ),
    );
  }

  async unassignInTransaction(
    db: SqlDatabase,
    session: SqlSession,
    numberId: Id,
    actorId: Id,
  ) {
    const assignments = db.table<AssignmentRecord>("number_assignments");
    const current = await assignments.findOne(
      { phoneNumberId: numberId, active: true },
      { session },
    );
    if (!current) throw new ConflictException("Number is not assigned");
    const now = new Date();
    const closed = await assignments.updateOne(
      { id: current.id, active: true },
      { $set: { active: false, endedAt: now } },
      { session },
    );
    if (!closed.matchedCount)
      throw new ConflictException("Number assignment changed");
    await this.audit.append(db, session, {
      type: "number.unassigned",
      actorId,
      phoneNumberId: numberId,
      customerId: current.customerId,
      previous: { customerId: current.customerId },
      next: null,
    });
    return { ...view(current), active: false, endedAt: now };
  }

  async assignInTransaction(
    db: SqlDatabase,
    session: SqlSession,
    numberId: Id,
    customerId: Id,
    actorId: Id,
  ): Promise<AssignmentRecord> {
    await this.requireCustomer(db, session, customerId);
    const number = await db
      .table("phone_numbers")
      .findOne({ id: numberId }, { session });
    if (!number) throw new NotFoundException("Number not found");
    if (number.status !== "active")
      throw new ConflictException("Number is not active");
    const active = await db
      .table<AssignmentRecord>("number_assignments")
      .findOne({ phoneNumberId: numberId, active: true }, { session });
    if (active) throw new ConflictException("Number is already assigned");
    const now = new Date();
    const record: AssignmentRecord = {
      id: uuid(),
      phoneNumberId: numberId,
      customerId,
      active: true,
      startedAt: now,
      createdAt: now,
    };
    await db
      .table<AssignmentRecord>("number_assignments")
      .insertOne(record, { session });
    await this.audit.append(db, session, {
      type: "number.assigned",
      actorId,
      phoneNumberId: numberId,
      customerId,
      previous: null,
      next: { customerId: customerId },
    });
    return record;
  }

  private async requireCustomer(
    db: SqlDatabase,
    session: SqlSession,
    id: Id,
  ): Promise<void> {
    const customer = await db
      .table("customers")
      .findOne({ id: id }, { session });
    if (!customer) throw new NotFoundException("Customer not found");
    if (customer.status !== "active")
      throw new ConflictException("Customer is inactive");
  }

  private async conflicts<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (
        error instanceof DatabaseError &&
        (error.code === "23505" || error.code === "40001")
      )
        throw new ConflictException(
          "Number assignment changed or already exists",
        );
      throw error;
    }
  }
}
