import { createHash, randomUUID } from "node:crypto";
import { ConflictException, Injectable } from "@nestjs/common";
import {
  DatabaseError,
  Id,
  SqlDatabase,
  SqlSession,
  uuid,
} from "../database/query";

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
    return this.database.sql().table<BackgroundJob>("background_jobs");
  }

  private events() {
    return this.database.sql().table<JobEvent>("job_events");
  }

  private prepare(input: CreateJobInput): BackgroundJob {
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
    const now = new Date();
    return {
      id: uuid(),
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
  }

  private async insertInTransaction(
    db: SqlDatabase,
    session: SqlSession,
    job: BackgroundJob,
  ): Promise<void> {
    await db
      .table<BackgroundJob>("background_jobs")
      .insertOne(job, { session });
    await db.table<JobEvent>("job_events").insertOne(
      {
        id: uuid(),
        jobId: job.id,
        sequence: 1,
        type: "queued",
        createdAt: job.createdAt,
      },
      { session },
    );
  }

  async createInTransaction(
    db: SqlDatabase,
    session: SqlSession,
    input: CreateJobInput,
  ): Promise<BackgroundJob> {
    const job = this.prepare(input);
    await this.insertInTransaction(db, session, job);
    return job;
  }

  async create(input: CreateJobInput): Promise<BackgroundJob> {
    await this.database.ensureReady();
    const job = this.prepare(input);
    try {
      await this.database.withTransaction(async (db, session) => {
        await this.insertInTransaction(db, session, job);
      });
      return job;
    } catch (error) {
      if (
        !(error instanceof DatabaseError) ||
        error.code !== "23505" ||
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
      { sort: { runAt: 1, id: 1 }, returnDocument: "after", skipLocked: true },
    );
    if (job)
      await this.appendEvent(job.id, "started", undefined, undefined, now);
    return job;
  }

  async heartbeat(job: BackgroundJob, leaseMs: number): Promise<boolean> {
    const now = new Date();
    const result = await this.jobs().updateOne(
      {
        id: job.id,
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
        .table<BackgroundJob>("background_jobs")
        .findOneAndUpdate(
          {
            id: job.id,
            status: "running",
            leaseToken: job.leaseToken,
            leaseUntil: { $gt: now },
            progress: { $lte: progress },
          },
          { $set: { progress, updatedAt: now }, $inc: { eventSequence: 1 } },
          { session, returnDocument: "after" },
        );
      if (!updated) return false;
      await db.table<JobEvent>("job_events").insertOne(
        {
          id: uuid(),
          jobId: job.id,
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
        .table<BackgroundJob>("background_jobs")
        .findOneAndUpdate(
          {
            id: job.id,
            status: "running",
            leaseToken: job.leaseToken,
            leaseUntil: { $gt: now },
          },
          { ...update, $inc: { eventSequence: 1 } },
          { session, returnDocument: "after" },
        );
      if (!updated) return false;
      await db.table<JobEvent>("job_events").insertOne(
        {
          id: uuid(),
          jobId: job.id,
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
    jobId: Id,
    type: JobEventType,
    message?: string,
    progress?: number,
    now = new Date(),
  ): Promise<void> {
    await this.database.withTransaction(async (db, session) => {
      const updated = await db
        .table<BackgroundJob>("background_jobs")
        .findOneAndUpdate(
          { id: jobId },
          { $inc: { eventSequence: 1 } },
          { session, returnDocument: "after" },
        );
      if (!updated) return;
      await db.table<JobEvent>("job_events").insertOne(
        {
          id: uuid(),
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

  async get(id: Id): Promise<BackgroundJob | null> {
    await this.database.ensureReady();
    return this.jobs().findOne({ id: id });
  }

  async list(limit = 50): Promise<BackgroundJob[]> {
    await this.database.ensureReady();
    return this.jobs()
      .find()
      .sort({ createdAt: -1, id: -1 })
      .limit(limit)
      .toArray();
  }

  async listEvents(
    jobId: Id,
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
