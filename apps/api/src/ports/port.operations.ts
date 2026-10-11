import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ClientSession, Db, ObjectId } from "mongodb";
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
  _id: ObjectId;
  carrierId: ObjectId;
  externalAccountId: string;
  credentialRef?: string;
  status: string;
}
interface Carrier {
  _id: ObjectId;
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
    const db = this.database.nativeDb();
    const account = await db
      .collection<Account>("carrier_accounts")
      .findOne({ _id: record.carrierAccountId, status: "active" });
    if (!account)
      throw new NotFoundException("Active carrier account not found");
    const carrier = await db
      .collection<Carrier>("carriers")
      .findOne({ _id: account.carrierId });
    if (!carrier) throw new NotFoundException("Carrier not found");
    if (carrier.code !== "mock")
      throw new ForbiddenException("Live port submission is disabled");
    const reference: CarrierAccount = {
      id: account._id.toHexString(),
      carrier: carrier.code,
      nativeAccountId: account.externalAccountId,
      credentialRef: account.credentialRef,
    };
    return { account, carrier, reference };
  }

  async submit(id: ObjectId, actorId: ObjectId, resubmit = false) {
    await this.database.ensureReady();
    const db = this.database.nativeDb();
    const port = await db
      .collection<PortRecord>("port_requests")
      .findOne({ _id: id });
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
        .collection("customers")
        .findOne({ _id: port.customerId, status: "active" }))
    )
      throw new ConflictException("Customer is not active");
    return this.database.withTransaction(async (tx, session) => {
      const current = await tx
        .collection<PortRecord>("port_requests")
        .findOne({ _id: id }, { session });
      if (!current || current.status !== "DRAFT")
        throw new ConflictException("Port request changed");
      const job = await this.jobs.createInTransaction(tx, session, {
        type: "port.submit",
        payload: { portId: id.toHexString() },
        idempotencyKey: `port-submit:${id.toHexString()}:${current.version}`,
        maxAttempts: 5,
      });
      const now = new Date();
      await tx.collection<PortRecord>("port_requests").updateOne(
        { _id: id, version: current.version },
        {
          $set: {
            status: "SUBMITTED",
            nativeStatus: "QUEUED",
            jobId: job._id,
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
        .collection("port_request_numbers")
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
        jobId: job._id,
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
    id: ObjectId,
    context: JobHandlerContext,
    override?: CarrierOrder,
  ): Promise<{ status: PortStatus }> {
    await this.database.ensureReady();
    const db = this.database.nativeDb();
    const port = await db
      .collection<PortRecord>("port_requests")
      .findOne({ _id: id });
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
        .collection("port_documents")
        .find({ portRequestId: id }, { projection: { _id: 1 } })
        .toArray()
    ).map((item) => item._id.toHexString());
    const result =
      override ??
      (await this.carriers.portSubmission(reference).submitPort(reference, {
        reference: `${id.toHexString()}:${port.version}`,
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
          .collection<PortRecord>("port_requests")
          .findOne({ _id: id }, { session });
        if (!current || current.status === "COMPLETED") return;
        const now = new Date();
        await tx.collection<PortRecord>("port_requests").updateOne(
          { _id: id },
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
          .collection("port_request_numbers")
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
            payload: { portId: id.toHexString() },
            idempotencyKey: `port-track:${id.toHexString()}:${current.version + 1}`,
            runAt: new Date(Date.now() + 60_000),
            maxAttempts: 5,
          });
      });
      return { status };
    }
    if (result.status === "failed") {
      await this.database.withTransaction(async (tx, session) => {
        const current = await tx
          .collection<PortRecord>("port_requests")
          .findOne({ _id: id }, { session });
        if (!current || current.status === "REJECTED") return;
        const now = new Date();
        await tx.collection<PortRecord>("port_requests").updateOne(
          { _id: id },
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
          .collection("port_request_numbers")
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
        .collection<PortRecord>("port_requests")
        .findOne({ _id: id }, { session });
      if (!current || current.status === "COMPLETED")
        return { status: "COMPLETED" as PortStatus };
      const account = await tx
        .collection<Account>("carrier_accounts")
        .findOne({ _id: current.carrierAccountId }, { session });
      if (!account) throw new NotFoundException("Carrier account not found");
      let newlyCompleted = 0;
      for (const e164 of confirmed) {
        const line = await tx
          .collection("port_request_numbers")
          .findOne({ portRequestId: id, e164 }, { session });
        if (line?.status === "COMPLETED") continue;
        const existing = await tx
          .collection<PhoneNumberRecord>("phone_numbers")
          .findOne({ e164 }, { session });
        const activeAssignment = existing
          ? await tx
              .collection("number_assignments")
              .findOne(
                { phoneNumberId: existing._id, active: true },
                { session },
              )
          : null;
        if (
          existing &&
          (!existing.carrierAccountId.equals(account._id) ||
            existing.status !== "active" ||
            activeAssignment)
        ) {
          await tx
            .collection<ReconciliationIssueRecord>("reconciliation_issues")
            .updateOne(
              {
                carrierAccountId: account._id,
                e164,
                type: "port_conflict",
                status: "open",
              },
              {
                $setOnInsert: {
                  _id: new ObjectId(),
                  phoneNumberId: existing._id,
                  detectedAt: new Date(),
                },
              },
              { upsert: true, session },
            );
          continue;
        }
        const now = new Date();
        const numberId = existing?._id ?? new ObjectId();
        if (!existing) {
          await tx.collection<PhoneNumberRecord>("phone_numbers").insertOne(
            {
              _id: numberId,
              e164,
              carrierId: account.carrierId,
              carrierAccountId: account._id,
              carrierNumberId: e164,
              status: "active",
              firstSeenAt: now,
              lastSeenAt: now,
              createdAt: now,
              updatedAt: now,
            },
            { session },
          );
          await tx.collection<HoldingRecord>("number_holdings").insertOne(
            {
              _id: new ObjectId(),
              phoneNumberId: numberId,
              carrierAccountId: account._id,
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
          next: { portRequestId: id.toHexString(), e164 },
        });
        await this.assignments.assignInTransaction(
          tx,
          session,
          numberId,
          current.customerId,
          current.actorId,
        );
        await tx
          .collection("port_request_numbers")
          .updateOne(
            { portRequestId: id, e164 },
            { $set: { status: "COMPLETED", completedAt: now } },
            { session },
          );
        newlyCompleted++;
      }
      const completedCount = await tx
        .collection("port_request_numbers")
        .countDocuments(
          { portRequestId: id, status: "COMPLETED" },
          { session },
        );
      const status: PortStatus =
        completedCount === current.numbers.length
          ? "COMPLETED"
          : current.focDate
            ? "DATE_CONFIRMED"
            : "SUBMITTED";
      const now = new Date();
      await tx.collection<PortRecord>("port_requests").updateOne(
        { _id: id },
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
          payload: { portId: id.toHexString() },
          idempotencyKey: `port-track:${id.toHexString()}:${current.version + 1}`,
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
    id: ObjectId,
    context: JobHandlerContext,
  ): Promise<{ status: PortStatus }> {
    await this.database.ensureReady();
    const port = await this.database
      .nativeDb()
      .collection<PortRecord>("port_requests")
      .findOne({ _id: id });
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
    tx: Db,
    session: ClientSession,
    id: ObjectId,
    customerId: ObjectId,
    actorId: ObjectId,
    type: string,
    previous: PortStatus,
    next: PortStatus,
    createdAt: Date,
  ) {
    await tx.collection("port_events").insertOne(
      {
        _id: new ObjectId(),
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
      next: { portRequestId: id.toHexString(), status: next },
    });
  }
}
