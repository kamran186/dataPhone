import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MongoServerError, ObjectId } from "mongodb";
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
} from "../inventory/inventory.types";
import { JobStore } from "../jobs/job.store";
import type { JobHandlerContext } from "../jobs/job.types";
import { AssignmentsService } from "../ownership/assignments.service";
import { AuditService } from "../ownership/audit.service";

interface AccountRecord {
  _id: ObjectId;
  carrierId: ObjectId;
  externalAccountId: string;
  credentialRef?: string;
  status: string;
}
interface CarrierRecord {
  _id: ObjectId;
  code: CarrierCode;
}
interface DisconnectRecord {
  _id: ObjectId;
  idempotencyKey: string;
  requestHash: string;
  phoneNumberId: ObjectId;
  e164: string;
  carrierAccountId: ObjectId;
  actorId: ObjectId;
  jobId: ObjectId;
  status:
    "queued" | "running" | "retrying" | "pending" | "completed" | "failed";
  nativeOrderId?: string;
  trackAttempt?: number;
  errorCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

function view(request: DisconnectRecord) {
  return {
    id: request._id.toHexString(),
    phoneNumberId: request.phoneNumberId.toHexString(),
    e164: request.e164,
    status: request.status,
    nativeOrderId: request.nativeOrderId,
    jobId: request.jobId.toHexString(),
    errorCode: request.errorCode,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

@Injectable()
export class DisconnectService {
  constructor(
    private readonly database: DatabaseService,
    private readonly carriers: CarrierRegistryService,
    private readonly jobs: JobStore,
    private readonly assignments: AssignmentsService,
    private readonly audit: AuditService,
  ) {}

  async create(
    numberId: ObjectId,
    confirmE164: string,
    idempotencyKey: string,
    actorId: ObjectId,
  ) {
    if (!/^[A-Za-z0-9:_-]{8,128}$/.test(idempotencyKey))
      throw new BadRequestException("Invalid idempotency key");
    await this.database.ensureReady();
    const db = this.database.nativeDb();
    const number = await db
      .collection<PhoneNumberRecord>("phone_numbers")
      .findOne({ _id: numberId });
    if (!number) throw new NotFoundException("Number not found");
    if (confirmE164 !== number.e164)
      throw new BadRequestException("Number confirmation does not match");
    const requestHash = createHash("sha256")
      .update(`${numberId.toHexString()}\n${number.e164}`)
      .digest("hex");
    const previous = await db
      .collection<DisconnectRecord>("disconnect_requests")
      .findOne({ idempotencyKey });
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new ConflictException(
          "Idempotency key already used for a different disconnect",
        );
      return view(previous);
    }
    const activeRequest = await db
      .collection<DisconnectRecord>("disconnect_requests")
      .findOne({
        phoneNumberId: numberId,
        status: { $in: ["queued", "running", "retrying", "pending"] },
      });
    if (activeRequest)
      throw new ConflictException(
        "Disconnect is already pending for this number",
      );
    if (number.status !== "active")
      throw new ConflictException("Number is not active");
    const account = await db
      .collection<AccountRecord>("carrier_accounts")
      .findOne({ _id: number.carrierAccountId, status: "active" });
    if (!account) throw new NotFoundException("Carrier account not found");
    const carrier = await db
      .collection<CarrierRecord>("carriers")
      .findOne({ _id: account.carrierId });
    if (!carrier) throw new NotFoundException("Carrier not found");
    if (carrier.code !== "mock")
      throw new ForbiddenException("Live billable disconnects are disabled");
    if (!this.carriers.capabilities(carrier.code).includes("number.disconnect"))
      throw new ConflictException(
        "Carrier disconnect capability is unavailable",
      );
    const now = new Date();
    try {
      const request = await this.database.withTransaction(
        async (tx, session) => {
          const id = new ObjectId();
          const job = await this.jobs.createInTransaction(tx, session, {
            type: "disconnect.execute",
            payload: { requestId: id.toHexString() },
            idempotencyKey: `disconnect:${idempotencyKey}`,
            maxAttempts: 5,
          });
          const record: DisconnectRecord = {
            _id: id,
            idempotencyKey,
            requestHash,
            phoneNumberId: numberId,
            e164: number.e164,
            carrierAccountId: number.carrierAccountId,
            actorId,
            jobId: job._id,
            status: "queued",
            createdAt: now,
            updatedAt: now,
          };
          await tx
            .collection<DisconnectRecord>("disconnect_requests")
            .insertOne(record, { session });
          return record;
        },
      );
      return view(request);
    } catch (error) {
      if (!(error instanceof MongoServerError && error.code === 11000))
        throw error;
      const existing = await db
        .collection<DisconnectRecord>("disconnect_requests")
        .findOne({ idempotencyKey });
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException(
            "Idempotency key already used for a different disconnect",
          );
        return view(existing);
      }
      throw new ConflictException(
        "Disconnect is already pending for this number",
      );
    }
  }

  async get(id: ObjectId) {
    await this.database.ensureReady();
    const request = await this.database
      .nativeDb()
      .collection<DisconnectRecord>("disconnect_requests")
      .findOne({ _id: id });
    if (!request) throw new NotFoundException("Disconnect request not found");
    return view(request);
  }

  async process(
    id: ObjectId,
    context: JobHandlerContext,
    providerOverride?: CarrierOrder,
  ): Promise<{ status: string }> {
    await this.database.ensureReady();
    const db = this.database.nativeDb();
    const requests = db.collection<DisconnectRecord>("disconnect_requests");
    const request = await requests.findOne({ _id: id });
    if (!request) throw new NotFoundException("Disconnect request not found");
    if (["completed", "failed"].includes(request.status))
      return { status: request.status };
    if (request.status === "pending" && !providerOverride)
      return this.track(id, context);
    if (context.signal.aborted) throw new Error("Disconnect job interrupted");
    const account = await db
      .collection<AccountRecord>("carrier_accounts")
      .findOne({ _id: request.carrierAccountId, status: "active" });
    if (!account) throw new NotFoundException("Carrier account not found");
    const carrier = await db
      .collection<CarrierRecord>("carriers")
      .findOne({ _id: account.carrierId });
    if (!carrier) throw new NotFoundException("Carrier not found");
    if (carrier.code !== "mock")
      throw new ForbiddenException("Live billable disconnects are disabled");
    const reference: CarrierAccount = {
      id: account._id.toHexString(),
      carrier: carrier.code,
      nativeAccountId: account.externalAccountId,
      credentialRef: account.credentialRef,
    };
    await requests.updateOne(
      { _id: id, status: { $in: ["queued", "retrying"] } },
      { $set: { status: "running", updatedAt: new Date() } },
    );
    await context.reportProgress(10, "Requesting carrier disconnect");
    let providerOrder: CarrierOrder;
    try {
      providerOrder =
        providerOverride ??
        (await this.carriers.disconnect(reference).disconnectNumber(reference, {
          e164: request.e164,
          idempotencyKey: request.idempotencyKey,
        }));
    } catch (error) {
      await requests.updateOne(
        { _id: id },
        {
          $set: {
            status:
              error instanceof CarrierError && error.retryable
                ? "retrying"
                : "failed",
            errorCode:
              error instanceof CarrierError ? error.kind : "DISCONNECT_FAILED",
            updatedAt: new Date(),
          },
        },
      );
      throw error;
    }
    if (context.signal.aborted) throw new Error("Disconnect job interrupted");
    if (providerOrder.status === "pending") {
      await this.database.withTransaction(async (tx, session) => {
        const fresh = await tx
          .collection<DisconnectRecord>("disconnect_requests")
          .findOne({ _id: id }, { session });
        if (!fresh) throw new NotFoundException("Disconnect request not found");
        const trackAttempt = (fresh.trackAttempt ?? 0) + 1;
        await tx.collection<DisconnectRecord>("disconnect_requests").updateOne(
          { _id: id },
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
            type: "disconnect.track",
            payload: { requestId: id.toHexString() },
            idempotencyKey: `disconnect-track:${id.toHexString()}:${trackAttempt}`,
            runAt: new Date(Date.now() + 60_000),
            maxAttempts: 5,
          });
      });
      return { status: "pending" };
    }
    if (providerOrder.status === "failed") {
      await requests.updateOne(
        { _id: id },
        {
          $set: {
            status: "failed",
            nativeOrderId: providerOrder.nativeOrderId,
            errorCode: "CARRIER_ORDER_FAILED",
            updatedAt: new Date(),
          },
        },
      );
      return { status: "failed" };
    }
    if (!providerOrder.numbers.some((number) => number === request.e164))
      throw new BadRequestException(
        "Carrier did not confirm the requested number",
      );
    await context.reportProgress(70, "Recording confirmed disconnect");
    await this.database.withTransaction(async (tx, session) => {
      const fresh = await tx
        .collection<DisconnectRecord>("disconnect_requests")
        .findOne({ _id: id }, { session });
      if (!fresh || fresh.status === "completed") return;
      const number = await tx
        .collection<PhoneNumberRecord>("phone_numbers")
        .findOne({ _id: request.phoneNumberId }, { session });
      if (!number) throw new NotFoundException("Number not found");
      const now = new Date();
      if (number.status === "active") {
        await tx
          .collection<PhoneNumberRecord>("phone_numbers")
          .updateOne(
            { _id: number._id },
            { $set: { status: "disconnected", updatedAt: now } },
            { session },
          );
        await tx
          .collection<HoldingRecord>("number_holdings")
          .updateOne(
            { phoneNumberId: number._id, status: "active" },
            { $set: { status: "closed", endedAt: now } },
            { session },
          );
        const assignment = await tx
          .collection("number_assignments")
          .findOne({ phoneNumberId: number._id, active: true }, { session });
        if (assignment)
          await this.assignments.unassignInTransaction(
            tx,
            session,
            number._id,
            request.actorId,
          );
        await this.audit.append(tx, session, {
          type: "number.disconnected",
          actorId: request.actorId,
          phoneNumberId: number._id,
          previous: { status: "active" },
          next: { status: "disconnected" },
        });
      }
      await tx.collection<DisconnectRecord>("disconnect_requests").updateOne(
        { _id: id },
        {
          $set: {
            status: "completed",
            nativeOrderId: providerOrder.nativeOrderId,
            updatedAt: now,
          },
        },
        { session },
      );
    });
    return { status: "completed" };
  }

  async track(
    id: ObjectId,
    context: JobHandlerContext,
  ): Promise<{ status: string }> {
    await this.database.ensureReady();
    const db = this.database.nativeDb();
    const request = await db
      .collection<DisconnectRecord>("disconnect_requests")
      .findOne({ _id: id });
    if (!request) throw new NotFoundException("Disconnect request not found");
    if (["completed", "failed"].includes(request.status))
      return { status: request.status };
    if (!request.nativeOrderId)
      throw new ConflictException("Carrier disconnect has not been accepted");
    const account = await db
      .collection<AccountRecord>("carrier_accounts")
      .findOne({ _id: request.carrierAccountId });
    if (!account) throw new NotFoundException("Carrier account not found");
    const carrier = await db
      .collection<CarrierRecord>("carriers")
      .findOne({ _id: account.carrierId });
    if (!carrier) throw new NotFoundException("Carrier not found");
    if (carrier.code !== "mock")
      throw new ForbiddenException("Live billable disconnects are disabled");
    const reference: CarrierAccount = {
      id: account._id.toHexString(),
      carrier: carrier.code,
      nativeAccountId: account.externalAccountId,
      credentialRef: account.credentialRef,
    };
    const result = await this.carriers
      .orderStatus(reference)
      .getOrderStatus(reference, request.nativeOrderId);
    return this.process(id, context, result);
  }
}
