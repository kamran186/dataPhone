import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseError, Id, uuid } from "../database/query";
import type {
  CarrierAccount,
  CarrierCode,
  CarrierOrder,
} from "../carriers/domain";
import { CarrierError } from "../carriers/errors";
import { CarrierRegistryService } from "../carriers/registry";
import { DatabaseService } from "../database/database.service";
import type {
  HoldingRecord,
  PhoneNumberRecord,
  ReconciliationIssueRecord,
} from "../inventory/inventory.types";
import { JobStore } from "../jobs/job.store";
import type { JobHandlerContext } from "../jobs/job.types";
import { AssignmentsService } from "../ownership/assignments.service";
import { AuditService } from "../ownership/audit.service";

interface AccountRecord {
  id: Id;
  carrierId: Id;
  externalAccountId: string;
  credentialRef?: string;
  status: string;
}
interface CarrierRecord {
  id: Id;
  code: CarrierCode;
}
interface PurchaseRecord {
  id: Id;
  idempotencyKey: string;
  requestHash: string;
  actorId: Id;
  customerId: Id;
  carrierAccountId: Id;
  nativeIds: string[];
  jobId: Id;
  status:
    | "queued"
    | "running"
    | "retrying"
    | "pending"
    | "completed"
    | "partial"
    | "failed";
  nativeOrderId?: string;
  trackAttempt?: number;
  items: Array<{ e164: string; status: "confirmed" | "conflict" }>;
  unfulfilledCount: number;
  errorCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

function view(order: PurchaseRecord) {
  return {
    id: order.id,
    status: order.status,
    carrierAccountId: order.carrierAccountId,
    customerId: order.customerId,
    nativeIds: order.nativeIds,
    nativeOrderId: order.nativeOrderId,
    items: order.items,
    unfulfilledCount: order.unfulfilledCount,
    jobId: order.jobId,
    errorCode: order.errorCode,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

function normalizedE164(raw: string): string {
  const digits = raw.replace(/[().\s-]/g, "");
  const e164 = /^\d{10}$/.test(digits)
    ? `+1${digits}`
    : /^1\d{10}$/.test(digits)
      ? `+${digits}`
      : digits;
  if (!/^\+[1-9]\d{1,14}$/.test(e164))
    throw new BadRequestException("Invalid carrier order number");
  return e164;
}

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly carriers: CarrierRegistryService,
    private readonly jobs: JobStore,
    private readonly assignments: AssignmentsService,
    private readonly audit: AuditService,
  ) {}

  async create(
    input: {
      carrierAccountId: Id;
      customerId: Id;
      nativeIds: string[];
      idempotencyKey: string;
    },
    actorId: Id,
  ) {
    if (!/^[A-Za-z0-9:_-]{8,128}$/.test(input.idempotencyKey))
      throw new BadRequestException("Invalid idempotency key");
    if (
      !Array.isArray(input.nativeIds) ||
      input.nativeIds.length < 1 ||
      input.nativeIds.length > 20 ||
      input.nativeIds.some(
        (id) => typeof id !== "string" || !/^[A-Za-z0-9:+._-]{1,128}$/.test(id),
      ) ||
      new Set(input.nativeIds).size !== input.nativeIds.length
    )
      throw new BadRequestException(
        "Provide 1 to 20 distinct carrier number IDs",
      );
    await this.database.ensureReady();
    const db = this.database.sql();
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          accountId: input.carrierAccountId,
          customerId: input.customerId,
          nativeIds: [...input.nativeIds].sort(),
        }),
      )
      .digest("hex");
    const previous = await db
      .table<PurchaseRecord>("purchase_orders")
      .findOne({ idempotencyKey: input.idempotencyKey });
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new ConflictException(
          "Idempotency key already used for a different purchase",
        );
      return view(previous);
    }
    const account = await db
      .table<AccountRecord>("carrier_accounts")
      .findOne({ id: input.carrierAccountId, status: "active" });
    if (!account) throw new NotFoundException("Carrier account not found");
    const carrier = await db
      .table<CarrierRecord>("carriers")
      .findOne({ id: account.carrierId });
    if (!carrier) throw new NotFoundException("Carrier not found");
    if (carrier.code !== "mock")
      throw new ForbiddenException("Live billable purchases are disabled");
    if (!this.carriers.capabilities(carrier.code).includes("number.purchase"))
      throw new ConflictException("Carrier purchase capability is unavailable");
    const customer = await db
      .table("customers")
      .findOne({ id: input.customerId, status: "active" });
    if (!customer) throw new NotFoundException("Active customer not found");
    const now = new Date();
    try {
      const order = await this.database.withTransaction(async (tx, session) => {
        const id = uuid();
        const job = await this.jobs.createInTransaction(tx, session, {
          type: "purchase.execute",
          payload: { orderId: id },
          idempotencyKey: `purchase:${input.idempotencyKey}`,
          maxAttempts: 5,
        });
        const record: PurchaseRecord = {
          id: id,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          actorId,
          customerId: input.customerId,
          carrierAccountId: input.carrierAccountId,
          nativeIds: input.nativeIds,
          jobId: job.id,
          status: "queued",
          items: [],
          unfulfilledCount: input.nativeIds.length,
          createdAt: now,
          updatedAt: now,
        };
        await tx
          .table<PurchaseRecord>("purchase_orders")
          .insertOne(record, { session });
        return record;
      });
      return view(order);
    } catch (error) {
      if (!(error instanceof DatabaseError && error.code === "23505"))
        throw error;
      const existing = await db
        .table<PurchaseRecord>("purchase_orders")
        .findOne({ idempotencyKey: input.idempotencyKey });
      if (!existing || existing.requestHash !== requestHash)
        throw new ConflictException(
          "Idempotency key already used for a different purchase",
        );
      return view(existing);
    }
  }

  async get(id: Id) {
    await this.database.ensureReady();
    const order = await this.database
      .sql()
      .table<PurchaseRecord>("purchase_orders")
      .findOne({ id: id });
    if (!order) throw new NotFoundException("Purchase order not found");
    return view(order);
  }

  async list(page = 1, pageSize = 25) {
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 10_000 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      throw new BadRequestException("Invalid purchase page");
    await this.database.ensureReady();
    const collection = this.database
      .sql()
      .table<PurchaseRecord>("purchase_orders");
    const [total, orders] = await Promise.all([
      collection.count(),
      collection
        .find()
        .sort({ createdAt: -1, id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
    ]);
    return { items: orders.map(view), total, page, pageSize };
  }

  async process(
    id: Id,
    context: JobHandlerContext,
    providerOverride?: CarrierOrder,
  ): Promise<{ status: string; confirmed: number }> {
    await this.database.ensureReady();
    const db = this.database.sql();
    const orders = db.table<PurchaseRecord>("purchase_orders");
    const order = await orders.findOne({ id: id });
    if (!order) throw new NotFoundException("Purchase order not found");
    if (["completed", "partial", "failed"].includes(order.status))
      return {
        status: order.status,
        confirmed: order.items.filter((item) => item.status === "confirmed")
          .length,
      };
    if (order.status === "pending" && !providerOverride)
      return this.track(id, context);
    if (context.signal.aborted) throw new Error("Purchase job interrupted");
    const account = await db
      .table<AccountRecord>("carrier_accounts")
      .findOne({ id: order.carrierAccountId, status: "active" });
    if (!account) throw new NotFoundException("Carrier account not found");
    const carrier = await db
      .table<CarrierRecord>("carriers")
      .findOne({ id: account.carrierId });
    if (!carrier) throw new NotFoundException("Carrier not found");
    if (carrier.code !== "mock")
      throw new ForbiddenException("Live billable purchases are disabled");
    const reference: CarrierAccount = {
      id: account.id,
      carrier: carrier.code,
      nativeAccountId: account.externalAccountId,
      credentialRef: account.credentialRef,
    };
    await orders.updateOne(
      { id: id, status: { $in: ["queued", "retrying"] } },
      { $set: { status: "running", updatedAt: new Date() } },
    );
    await context.reportProgress(10, "Requesting carrier order");
    let providerOrder: CarrierOrder;
    try {
      providerOrder =
        providerOverride ??
        (await this.carriers.purchase(reference).purchaseNumbers(reference, {
          nativeIds: order.nativeIds,
          idempotencyKey: order.idempotencyKey,
        }));
    } catch (error) {
      await orders.updateOne(
        { id: id },
        {
          $set: {
            status:
              error instanceof CarrierError && error.retryable
                ? "retrying"
                : "failed",
            errorCode:
              error instanceof CarrierError ? error.kind : "PURCHASE_FAILED",
            updatedAt: new Date(),
          },
        },
      );
      throw error;
    }
    if (context.signal.aborted) throw new Error("Purchase job interrupted");
    if (providerOrder.status === "pending") {
      await this.database.withTransaction(async (tx, session) => {
        const fresh = await tx
          .table<PurchaseRecord>("purchase_orders")
          .findOne({ id: id }, { session });
        if (!fresh) throw new NotFoundException("Purchase order not found");
        const trackAttempt = (fresh.trackAttempt ?? 0) + 1;
        await tx.table<PurchaseRecord>("purchase_orders").updateOne(
          { id: id },
          {
            $set: {
              status: "pending",
              nativeOrderId: providerOrder.nativeOrderId,
              trackAttempt,
              updatedAt: new Date(),
            },
          },
          { session },
        );
        if (
          trackAttempt <= 10_080 &&
          this.carriers.capabilities(carrier.code).includes("order.status")
        )
          await this.jobs.createInTransaction(tx, session, {
            type: "purchase.track",
            payload: { orderId: id },
            idempotencyKey: `purchase-track:${id}:${trackAttempt}`,
            runAt: new Date(Date.now() + 60_000),
            maxAttempts: 5,
          });
      });
      return { status: "pending", confirmed: 0 };
    }
    if (providerOrder.status === "failed") {
      await orders.updateOne(
        { id: id },
        {
          $set: {
            status: "failed",
            nativeOrderId: providerOrder.nativeOrderId,
            errorCode: "CARRIER_ORDER_FAILED",
            updatedAt: new Date(),
          },
        },
      );
      return { status: "failed", confirmed: 0 };
    }
    const numbers = [...new Set(providerOrder.numbers.map(normalizedE164))];
    if (numbers.length > order.nativeIds.length)
      throw new BadRequestException(
        "Carrier returned more numbers than requested",
      );
    await context.reportProgress(70, "Recording confirmed numbers");
    const updated = await this.database.withTransaction(async (tx, session) => {
      const fresh = await tx
        .table<PurchaseRecord>("purchase_orders")
        .findOne({ id: id }, { session });
      if (!fresh) throw new NotFoundException("Purchase order not found");
      if (["completed", "partial", "failed"].includes(fresh.status))
        return fresh;
      const items: PurchaseRecord["items"] = [];
      for (const e164 of numbers) {
        const existing = await tx
          .table<PhoneNumberRecord>("phone_numbers")
          .findOne({ e164 }, { session });
        if (existing && existing.carrierAccountId !== account.id) {
          await tx
            .table<ReconciliationIssueRecord>("reconciliation_issues")
            .updateOne(
              {
                carrierAccountId: account.id,
                e164,
                type: "purchase_conflict",
                status: "open",
              },
              {
                $setOnInsert: {
                  id: uuid(),
                  phoneNumberId: existing.id,
                  detectedAt: new Date(),
                },
              },
              { upsert: true, session },
            );
          items.push({ e164, status: "conflict" });
          continue;
        }
        const activeAssignment =
          existing &&
          (await tx
            .table("number_assignments")
            .findOne(
              { phoneNumberId: existing.id, active: true },
              { session },
            ));
        if (activeAssignment) {
          await tx
            .table<ReconciliationIssueRecord>("reconciliation_issues")
            .updateOne(
              {
                carrierAccountId: account.id,
                e164,
                type: "purchase_conflict",
                status: "open",
              },
              {
                $setOnInsert: {
                  id: uuid(),
                  phoneNumberId: existing!.id,
                  detectedAt: new Date(),
                },
              },
              { upsert: true, session },
            );
          items.push({ e164, status: "conflict" });
          continue;
        }
        const now = new Date();
        const numberId = existing?.id ?? uuid();
        if (!existing) {
          await tx.table<PhoneNumberRecord>("phone_numbers").insertOne(
            {
              id: numberId,
              e164,
              carrierId: carrier.id,
              carrierAccountId: account.id,
              carrierNumberId: e164,
              status: "active",
              firstSeenAt: now,
              lastSeenAt: now,
              createdAt: now,
              updatedAt: now,
            },
            { session },
          );
          await tx.table<HoldingRecord>("number_holdings").insertOne(
            {
              id: uuid(),
              phoneNumberId: numberId,
              carrierAccountId: account.id,
              status: "active",
              startedAt: now,
              createdAt: now,
            },
            { session },
          );
        } else if (existing.status !== "active") {
          await tx
            .table<PhoneNumberRecord>("phone_numbers")
            .updateOne(
              { id: numberId },
              { $set: { status: "active", lastSeenAt: now, updatedAt: now } },
              { session },
            );
          await tx.table<HoldingRecord>("number_holdings").insertOne(
            {
              id: uuid(),
              phoneNumberId: numberId,
              carrierAccountId: account.id,
              status: "active",
              startedAt: now,
              createdAt: now,
            },
            { session },
          );
        }
        await this.audit.append(tx, session, {
          type: "number.purchased",
          actorId: order.actorId,
          customerId: order.customerId,
          phoneNumberId: numberId,
          previous: null,
          next: { carrierAccountId: account.id, e164 },
        });
        await this.assignments.assignInTransaction(
          tx,
          session,
          numberId,
          order.customerId,
          order.actorId,
        );
        items.push({ e164, status: "confirmed" });
      }
      const confirmed = items.filter(
        (item) => item.status === "confirmed",
      ).length;
      const status =
        confirmed === order.nativeIds.length
          ? "completed"
          : confirmed
            ? "partial"
            : "failed";
      const next: PurchaseRecord = {
        ...fresh,
        status,
        nativeOrderId: providerOrder.nativeOrderId,
        items,
        unfulfilledCount: order.nativeIds.length - confirmed,
        updatedAt: new Date(),
      };
      await tx
        .table<PurchaseRecord>("purchase_orders")
        .replaceOne({ id: id }, next, { session });
      return next;
    });
    return {
      status: updated.status,
      confirmed: updated.items.filter((item) => item.status === "confirmed")
        .length,
    };
  }

  async track(
    id: Id,
    context: JobHandlerContext,
  ): Promise<{ status: string; confirmed: number }> {
    await this.database.ensureReady();
    const db = this.database.sql();
    const order = await db
      .table<PurchaseRecord>("purchase_orders")
      .findOne({ id: id });
    if (!order) throw new NotFoundException("Purchase order not found");
    if (["completed", "partial", "failed"].includes(order.status))
      return {
        status: order.status,
        confirmed: order.items.filter((item) => item.status === "confirmed")
          .length,
      };
    if (!order.nativeOrderId)
      throw new ConflictException("Carrier order has not been accepted");
    const account = await db
      .table<AccountRecord>("carrier_accounts")
      .findOne({ id: order.carrierAccountId });
    if (!account) throw new NotFoundException("Carrier account not found");
    const carrier = await db
      .table<CarrierRecord>("carriers")
      .findOne({ id: account.carrierId });
    if (!carrier) throw new NotFoundException("Carrier not found");
    if (carrier.code !== "mock")
      throw new ForbiddenException("Live billable purchases are disabled");
    const reference: CarrierAccount = {
      id: account.id,
      carrier: carrier.code,
      nativeAccountId: account.externalAccountId,
      credentialRef: account.credentialRef,
    };
    const result = await this.carriers
      .orderStatus(reference)
      .getOrderStatus(reference, order.nativeOrderId);
    return this.process(id, context, result);
  }
}
