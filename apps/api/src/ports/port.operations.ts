import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Id, SqlDatabase, SqlSession, uuid } from "../database/query";
import type {
  CarrierAccount,
  CarrierCode,
  CarrierOrder,
} from "../carriers/domain";
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
import { PortRecord, PortStatus, portView } from "./port.requests";

interface Account {
  id: Id;
  carrierId: Id;
  externalAccountId: string;
  credentialRef?: string;
  status: string;
}
interface Carrier {
  id: Id;
  code: CarrierCode;
}

@Injectable()
export class PortOperations {
  constructor(
    private readonly database: DatabaseService,
    private readonly carriers: CarrierRegistryService,
    private readonly jobs: JobStore,
    private readonly assignments: AssignmentsService,
    private readonly audit: AuditService,
  ) {}

  private async reference(record: PortRecord) {
    const db = this.database.sql();
    const account = await db
      .table<Account>("carrier_accounts")
      .findOne({ id: record.carrierAccountId, status: "active" });
    if (!account)
      throw new NotFoundException("Active carrier account not found");
    const carrier = await db
      .table<Carrier>("carriers")
      .findOne({ id: account.carrierId });
    if (!carrier) throw new NotFoundException("Carrier not found");
    if (carrier.code !== "mock")
      throw new ForbiddenException("Live port submission is disabled");
    const reference: CarrierAccount = {
      id: account.id,
      carrier: carrier.code,
      nativeAccountId: account.externalAccountId,
      credentialRef: account.credentialRef,
    };
    return { account, carrier, reference };
  }

  async submit(id: Id, actorId: Id, resubmit = false) {
    await this.database.ensureReady();
    const db = this.database.sql();
    const port = await db
      .table<PortRecord>("port_requests")
      .findOne({ id: id });
    if (!port) throw new NotFoundException("Port request not found");
    if (port.status !== "DRAFT")
      throw new ConflictException("Only a draft port can be submitted");
    if (resubmit && !port.nativeOrderId)
      throw new ConflictException("This port was never submitted");
    const { carrier } = await this.reference(port);
    if (!this.carriers.capabilities(carrier.code).includes("port.submit"))
      throw new ConflictException("Carrier port submission is unavailable");
    if (
      !(await db
        .table("customers")
        .findOne({ id: port.customerId, status: "active" }))
    )
      throw new ConflictException("Customer is not active");
    return this.database.withTransaction(async (tx, session) => {
      const current = await tx
        .table<PortRecord>("port_requests")
        .findOne({ id: id }, { session });
      if (!current || current.status !== "DRAFT")
        throw new ConflictException("Port request changed");
      const job = await this.jobs.createInTransaction(tx, session, {
        type: "port.submit",
        payload: { portId: id },
        idempotencyKey: `port-submit:${id}:${current.version}`,
        maxAttempts: 5,
      });
      const now = new Date();
      await tx.table<PortRecord>("port_requests").updateOne(
        { id: id, version: current.version },
        {
          $set: {
            status: "SUBMITTED",
            nativeStatus: "QUEUED",
            jobId: job.id,
            actorId,
            updatedAt: now,
          },
          $unset: {
            nativeOrderId: "",
            focDate: "",
            rejectionReason: "",
            unfulfilledCount: "",
          },
          $inc: { version: 1 },
        },
        { session },
      );
      await tx
        .table("port_request_numbers")
        .updateMany(
          { portRequestId: id },
          { $set: { status: "SUBMITTED" } },
          { session },
        );
      await this.record(
        tx,
        session,
        id,
        current.customerId,
        actorId,
        resubmit ? "port.resubmitted" : "port.submitted",
        current.status,
        "SUBMITTED",
        now,
      );
      return portView({
        ...current,
        status: "SUBMITTED",
        nativeStatus: "QUEUED",
        jobId: job.id,
        actorId,
        nativeOrderId: undefined,
        focDate: undefined,
        rejectionReason: undefined,
        version: current.version + 1,
        updatedAt: now,
      });
    });
  }

  async process(
    id: Id,
    context: JobHandlerContext,
    override?: CarrierOrder,
  ): Promise<{ status: PortStatus }> {
    await this.database.ensureReady();
    const db = this.database.sql();
    const port = await db
      .table<PortRecord>("port_requests")
      .findOne({ id: id });
    if (!port) throw new NotFoundException("Port request not found");
    if (port.status === "COMPLETED" || port.status === "CANCELLED")
      return { status: port.status };
    if (!["SUBMITTED", "DATE_CONFIRMED"].includes(port.status))
      throw new ConflictException("Port is not submitted");
    if (context.signal.aborted) throw new Error("Port job interrupted");
    const { carrier, reference } = await this.reference(port);
    if (port.nativeOrderId && !override) return this.track(id, context);
    await context.reportProgress(10, "Submitting mock port order");
    const documentIds = (
      await db
        .table("port_documents")
        .find({ portRequestId: id }, { projection: { id: 1 } })
        .toArray()
    ).map((item) => item.id);
    const result =
      override ??
      (await this.carriers.portSubmission(reference).submitPort(reference, {
        reference: `${id}:${port.version}`,
        numbers: port.numbers,
        documentIds,
      }));
    if (!result.nativeOrderId)
      throw new BadRequestException("Carrier order ID is missing");
    if (result.status === "pending") {
      let focDate: Date | undefined;
      if (result.focDate) {
        focDate = new Date(`${result.focDate}T00:00:00.000Z`);
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(result.focDate) ||
          Number.isNaN(focDate.getTime()) ||
          focDate.toISOString().slice(0, 10) !== result.focDate
        )
          throw new BadRequestException("Invalid carrier FOC date");
      }
      const status: PortStatus =
        focDate || port.focDate ? "DATE_CONFIRMED" : "SUBMITTED";
      await this.database.withTransaction(async (tx, session) => {
        const current = await tx
          .table<PortRecord>("port_requests")
          .findOne({ id: id }, { session });
        if (!current || current.status === "COMPLETED") return;
        const now = new Date();
        await tx.table<PortRecord>("port_requests").updateOne(
          { id: id },
          {
            $set: {
              status,
              nativeOrderId: result.nativeOrderId,
              nativeStatus: result.nativeStatus ?? "PENDING",
              ...(focDate ? { focDate } : {}),
              updatedAt: now,
            },
            $inc: { version: 1 },
          },
          { session },
        );
        await tx
          .table("port_request_numbers")
          .updateMany(
            { portRequestId: id, status: { $ne: "COMPLETED" } },
            { $set: { status } },
            { session },
          );
        if (
          current.status !== status ||
          current.nativeStatus !== (result.nativeStatus ?? "PENDING")
        )
          await this.record(
            tx,
            session,
            id,
            current.customerId,
            current.actorId,
            focDate ? "port.date_confirmed" : "port.pending",
            current.status,
            status,
            now,
          );
        if (this.carriers.capabilities(carrier.code).includes("order.status"))
          await this.jobs.createInTransaction(tx, session, {
            type: "port.track",
            payload: { portId: id },
            idempotencyKey: `port-track:${id}:${current.version + 1}`,
            runAt: new Date(Date.now() + 60_000),
            maxAttempts: 5,
          });
      });
      return { status };
    }
    if (result.status === "failed") {
      await this.database.withTransaction(async (tx, session) => {
        const current = await tx
          .table<PortRecord>("port_requests")
          .findOne({ id: id }, { session });
        if (!current || current.status === "REJECTED") return;
        const now = new Date();
        await tx.table<PortRecord>("port_requests").updateOne(
          { id: id },
          {
            $set: {
              status: "REJECTED",
              nativeOrderId: result.nativeOrderId,
              nativeStatus: result.nativeStatus ?? "REJECTED",
              rejectionReason: result.rejectionReason,
              updatedAt: now,
            },
            $inc: { version: 1 },
          },
          { session },
        );
        await tx
          .table("port_request_numbers")
          .updateMany(
            { portRequestId: id },
            { $set: { status: "REJECTED" } },
            { session },
          );
        await this.record(
          tx,
          session,
          id,
          current.customerId,
          current.actorId,
          "port.rejected",
          current.status,
          "REJECTED",
          now,
        );
      });
      return { status: "REJECTED" };
    }
    await context.reportProgress(70, "Recording completed port numbers");
    const confirmed = [...new Set(result.numbers)];
    if (confirmed.some((number) => !port.numbers.includes(number)))
      throw new BadRequestException(
        "Carrier returned an unexpected port number",
      );
    return this.database.withTransaction(async (tx, session) => {
      const current = await tx
        .table<PortRecord>("port_requests")
        .findOne({ id: id }, { session });
      if (!current || current.status === "COMPLETED")
        return { status: "COMPLETED" as PortStatus };
      const account = await tx
        .table<Account>("carrier_accounts")
        .findOne({ id: current.carrierAccountId }, { session });
      if (!account) throw new NotFoundException("Carrier account not found");
      let newlyCompleted = 0;
      for (const e164 of confirmed) {
        const line = await tx
          .table("port_request_numbers")
          .findOne({ portRequestId: id, e164 }, { session });
        if (line?.status === "COMPLETED") continue;
        const existing = await tx
          .table<PhoneNumberRecord>("phone_numbers")
          .findOne({ e164 }, { session });
        const activeAssignment = existing
          ? await tx
              .table("number_assignments")
              .findOne(
                { phoneNumberId: existing.id, active: true },
                { session },
              )
          : null;
        if (
          existing &&
          (existing.carrierAccountId !== account.id ||
            existing.status !== "active" ||
            activeAssignment)
        ) {
          await tx
            .table<ReconciliationIssueRecord>("reconciliation_issues")
            .updateOne(
              {
                carrierAccountId: account.id,
                e164,
                type: "port_conflict",
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
          continue;
        }
        const now = new Date();
        const numberId = existing?.id ?? uuid();
        if (!existing) {
          await tx.table<PhoneNumberRecord>("phone_numbers").insertOne(
            {
              id: numberId,
              e164,
              carrierId: account.carrierId,
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
        }
        await this.audit.append(tx, session, {
          type: "number.ported",
          actorId: current.actorId,
          customerId: current.customerId,
          phoneNumberId: numberId,
          previous: null,
          next: { portRequestId: id, e164 },
        });
        await this.assignments.assignInTransaction(
          tx,
          session,
          numberId,
          current.customerId,
          current.actorId,
        );
        await tx
          .table("port_request_numbers")
          .updateOne(
            { portRequestId: id, e164 },
            { $set: { status: "COMPLETED", completedAt: now } },
            { session },
          );
        newlyCompleted++;
      }
      const completedCount = await tx
        .table("port_request_numbers")
        .count({ portRequestId: id, status: "COMPLETED" }, { session });
      const status: PortStatus =
        completedCount === current.numbers.length
          ? "COMPLETED"
          : current.focDate
            ? "DATE_CONFIRMED"
            : "SUBMITTED";
      const now = new Date();
      await tx.table<PortRecord>("port_requests").updateOne(
        { id: id },
        {
          $set: {
            status,
            nativeOrderId: result.nativeOrderId,
            nativeStatus:
              result.nativeStatus ??
              (status === "COMPLETED" ? "COMPLETED" : "PARTIAL"),
            unfulfilledCount: current.numbers.length - completedCount,
            updatedAt: now,
          },
          $inc: { version: 1 },
        },
        { session },
      );
      if (
        status !== "COMPLETED" &&
        this.carriers.capabilities("mock").includes("order.status")
      )
        await this.jobs.createInTransaction(tx, session, {
          type: "port.track",
          payload: { portId: id },
          idempotencyKey: `port-track:${id}:${current.version + 1}`,
          runAt: new Date(Date.now() + 60_000),
          maxAttempts: 5,
        });
      if (newlyCompleted || status !== current.status)
        await this.record(
          tx,
          session,
          id,
          current.customerId,
          current.actorId,
          status === "COMPLETED" ? "port.completed" : "port.partial",
          current.status,
          status,
          now,
        );
      return { status };
    });
  }

  async track(
    id: Id,
    context: JobHandlerContext,
  ): Promise<{ status: PortStatus }> {
    await this.database.ensureReady();
    const port = await this.database
      .sql()
      .table<PortRecord>("port_requests")
      .findOne({ id: id });
    if (!port) throw new NotFoundException("Port request not found");
    if (["COMPLETED", "CANCELLED", "REJECTED"].includes(port.status))
      return { status: port.status };
    if (!port.nativeOrderId)
      throw new ConflictException("Carrier port order is not accepted");
    const { reference } = await this.reference(port);
    const result = await this.carriers
      .orderStatus(reference)
      .getOrderStatus(reference, port.nativeOrderId);
    return this.process(id, context, result);
  }

  private async record(
    tx: SqlDatabase,
    session: SqlSession,
    id: Id,
    customerId: Id,
    actorId: Id,
    type: string,
    previous: PortStatus,
    next: PortStatus,
    createdAt: Date,
  ) {
    await tx.table("port_events").insertOne(
      {
        id: uuid(),
        portRequestId: id,
        type,
        actorId,
        previous: { status: previous },
        next: { status: next },
        createdAt,
      },
      { session },
    );
    await this.audit.append(tx, session, {
      type,
      actorId,
      customerId,
      previous: { status: previous },
      next: { portRequestId: id, status: next },
    });
  }
}
