import { createHash, randomUUID } from "node:crypto";
import { ConflictException, Injectable } from "@nestjs/common";
import { MongoServerError, ObjectId } from "mongodb";
import { DatabaseService } from "../database/database.service";
import type {
  BackgroundJob,
  CreateJobInput,
  JobEvent,
  JobEventType,
  JobFailure,
} from "./job.types";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function fingerprint(type: string, payload: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify(stable({ type, payload })))
    .digest("hex");
}

function backoffMs(attempts: number, retryAfterMs?: number): number {
  return Math.max(
    Math.min(3_600_000, 1_000 * 2 ** Math.min(attempts - 1, 12)),
    Math.min(3_600_000, Math.max(0, retryAfterMs ?? 0)),
  );
}

@Injectable()
export class JobStore {
  constructor(private readonly database: DatabaseService) {}

  private jobs() {
    return this.database
      .nativeDb()
      .collection<BackgroundJob>("background_jobs");
  }

  private events() {
    return this.database.nativeDb().collection<JobEvent>("job_events");
  }

  async create(input: CreateJobInput): Promise<BackgroundJob> {
    if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(input.type))
      throw new Error("Invalid job type");
    if (
      input.idempotencyKey &&
      !/^[a-zA-Z0-9:_-]{8,128}$/.test(input.idempotencyKey)
    )
      throw new Error("Invalid idempotency key");
    const maxAttempts = input.maxAttempts ?? 3;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10)
      throw new Error("Invalid maximum attempts");
    await this.database.ensureReady();
    const now = new Date();
    const job: BackgroundJob = {
      _id: new ObjectId(),
      type: input.type,
      payload: input.payload,
      fingerprint: fingerprint(input.type, input.payload),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      status: "queued",
      attempts: 0,
      maxAttempts,
      runAt: input.runAt ?? now,
      progress: 0,
      eventSequence: 1,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.database.withTransaction(async (db, session) => {
        await db
          .collection<BackgroundJob>("background_jobs")
          .insertOne(job, { session });
        await db.collection<JobEvent>("job_events").insertOne(
          {
            _id: new ObjectId(),
            jobId: job._id,
            sequence: 1,
            type: "queued",
            createdAt: now,
          },
          { session },
        );
      });
      return job;
    } catch (error) {
      if (
        !(error instanceof MongoServerError) ||
        error.code !== 11000 ||
        !input.idempotencyKey
      )
        throw error;
      const existing = await this.jobs().findOne({
        idempotencyKey: input.idempotencyKey,
      });
      if (!existing || existing.fingerprint !== job.fingerprint)
        throw new ConflictException(
          "Idempotency key already used for a different job",
        );
      return existing;
    }
  }

  async claim(
    owner: string,
    leaseMs: number,
    now = new Date(),
  ): Promise<BackgroundJob | null> {
    await this.database.ensureReady();
    const job = await this.jobs().findOneAndUpdate(
      {
        $or: [
          { status: "queued", runAt: { $lte: now } },
          { status: "running", leaseUntil: { $lte: now } },
        ],
      },
      {
        $set: {
          status: "running",
          leaseUntil: new Date(now.getTime() + leaseMs),
          leaseOwner: owner,
          leaseToken: randomUUID(),
          updatedAt: now,
        },
        $inc: { attempts: 1 },
      },
      { sort: { runAt: 1, _id: 1 }, returnDocument: "after" },
    );
    if (job)
      await this.appendEvent(job._id, "started", undefined, undefined, now);
    return job;
  }

  async heartbeat(job: BackgroundJob, leaseMs: number): Promise<boolean> {
    const now = new Date();
    const result = await this.jobs().updateOne(
      {
        _id: job._id,
        status: "running",
        leaseToken: job.leaseToken,
        leaseUntil: { $gt: now },
      },
      {
        $set: { leaseUntil: new Date(now.getTime() + leaseMs), updatedAt: now },
      },
    );
    return result.matchedCount === 1;
  }

  async progress(
    job: BackgroundJob,
    progress: number,
    message?: string,
  ): Promise<boolean> {
    if (!Number.isInteger(progress) || progress < 0 || progress > 100)
      throw new Error("Progress must be 0 to 100");
    const now = new Date();
    return this.database.withTransaction(async (db, session) => {
      const updated = await db
        .collection<BackgroundJob>("background_jobs")
        .findOneAndUpdate(
          {
            _id: job._id,
            status: "running",
            leaseToken: job.leaseToken,
            leaseUntil: { $gt: now },
            progress: { $lte: progress },
          },
          { $set: { progress, updatedAt: now }, $inc: { eventSequence: 1 } },
          { session, returnDocument: "after" },
        );
      if (!updated) return false;
      await db.collection<JobEvent>("job_events").insertOne(
        {
          _id: new ObjectId(),
          jobId: job._id,
          sequence: updated.eventSequence,
          type: "progress",
          progress,
          message,
          createdAt: now,
        },
        { session },
      );
      return true;
    });
  }

  async succeed(
    job: BackgroundJob,
    result: Record<string, unknown>,
  ): Promise<boolean> {
    const now = new Date();
    return this.finish(
      job,
      "succeeded",
      {
        $set: {
          status: "succeeded",
          result,
          progress: 100,
          finishedAt: now,
          updatedAt: now,
        },
        $unset: { leaseUntil: "", leaseToken: "", leaseOwner: "" },
      },
      "succeeded",
      now,
    );
  }

  async fail(
    job: BackgroundJob,
    failure: JobFailure,
  ): Promise<"retry" | "failed" | "stale"> {
    const now = new Date();
    const retry = failure.retryable && job.attempts < job.maxAttempts;
    const status = retry ? "queued" : "failed";
    const safeFailure = {
      code: failure.code,
      message: failure.message,
      retryable: failure.retryable,
    };
    const accepted = await this.finish(
      job,
      status,
      {
        $set: {
          status,
          failure: safeFailure,
          updatedAt: now,
          ...(retry
            ? {
                runAt: new Date(
                  now.getTime() + backoffMs(job.attempts, failure.retryAfterMs),
                ),
              }
            : { finishedAt: now }),
        },
        $unset: { leaseUntil: "", leaseToken: "", leaseOwner: "" },
      },
      retry ? "retry" : "failed",
      now,
    );
    return accepted ? (retry ? "retry" : "failed") : "stale";
  }

  private async finish(
    job: BackgroundJob,
    status: "queued" | "succeeded" | "failed",
    update: Record<string, unknown>,
    eventType: JobEventType,
    now: Date,
  ): Promise<boolean> {
    return this.database.withTransaction(async (db, session) => {
      const updated = await db
        .collection<BackgroundJob>("background_jobs")
        .findOneAndUpdate(
          {
            _id: job._id,
            status: "running",
            leaseToken: job.leaseToken,
            leaseUntil: { $gt: now },
          },
          { ...update, $inc: { eventSequence: 1 } },
          { session, returnDocument: "after" },
        );
      if (!updated) return false;
      await db.collection<JobEvent>("job_events").insertOne(
        {
          _id: new ObjectId(),
          jobId: job._id,
          sequence: updated.eventSequence,
          type: eventType,
          createdAt: now,
        },
        { session },
      );
      return true;
    });
  }

  async appendEvent(
    jobId: ObjectId,
    type: JobEventType,
    message?: string,
    progress?: number,
    now = new Date(),
  ): Promise<void> {
    await this.database.withTransaction(async (db, session) => {
      const updated = await db
        .collection<BackgroundJob>("background_jobs")
        .findOneAndUpdate(
          { _id: jobId },
          { $inc: { eventSequence: 1 } },
          { session, returnDocument: "after" },
        );
      if (!updated) return;
      await db.collection<JobEvent>("job_events").insertOne(
        {
          _id: new ObjectId(),
          jobId,
          sequence: updated.eventSequence,
          type,
          message,
          progress,
          createdAt: now,
        },
        { session },
      );
    });
  }

  async get(id: ObjectId): Promise<BackgroundJob | null> {
    await this.database.ensureReady();
    return this.jobs().findOne({ _id: id });
  }

  async list(limit = 50): Promise<BackgroundJob[]> {
    await this.database.ensureReady();
    return this.jobs()
      .find()
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
  }

  async listEvents(
    jobId: ObjectId,
    after?: number,
    limit = 100,
  ): Promise<JobEvent[]> {
    await this.database.ensureReady();
    return this.events()
      .find({ jobId, ...(after ? { sequence: { $gt: after } } : {}) })
      .sort({ sequence: 1 })
      .limit(limit)
      .toArray();
  }
}
