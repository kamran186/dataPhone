import { randomUUID } from "node:crypto";
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  EMPTY,
  Subscription,
  catchError,
  concatMap,
  from,
  interval,
  startWith,
} from "rxjs";
import { CarrierError } from "../carriers/errors";
import type { BackgroundJob, JobFailure, JobHandler } from "./job.types";
import { JobStore } from "./job.store";

export class JobExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

function classify(error: unknown): JobFailure {
  if (error instanceof JobExecutionError)
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
    };
  if (error instanceof CarrierError)
    return {
      code: `CARRIER_${error.kind.toUpperCase()}`,
      message: error.message,
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
    };
  return {
    code: "JOB_FAILED",
    message: "Job execution failed",
    retryable: false,
  };
}

@Injectable()
export class JobWorker implements OnModuleInit, OnModuleDestroy {
  private readonly concurrency = 4;
  private readonly leaseMs = 30_000;
  private readonly pollMs = 1_000;
  private readonly maxRunMs = 300_000;
  private readonly owner = randomUUID();
  private readonly handlers = new Map<string, JobHandler>();
  private readonly active = new Map<string, AbortController>();
  private readonly running = new Set<Promise<void>>();
  private subscription?: Subscription;
  private polling = false;

  constructor(private readonly store: JobStore) {
    this.register("system.noop", async (_payload, context) => {
      await context.reportProgress(50, "Processing");
      return { ok: true };
    });
  }

  register(type: string, handler: JobHandler): void {
    if (this.handlers.has(type))
      throw new Error(`Duplicate job handler: ${type}`);
    this.handlers.set(type, handler);
  }

  onModuleInit(): void {
    if (process.env.DATAPHONE_JOB_WORKER_DISABLED === "true") return;
    this.subscription = interval(this.pollMs)
      .pipe(
        startWith(0),
        concatMap(() => from(this.tick()).pipe(catchError(() => EMPTY))),
      )
      .subscribe();
  }

  async onModuleDestroy(): Promise<void> {
    this.subscription?.unsubscribe();
    for (const controller of this.active.values()) controller.abort();
    let timeout: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled(this.running),
      new Promise((resolve) => {
        timeout = setTimeout(resolve, 2_000);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
  }

  async tick(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      while (this.active.size < this.concurrency) {
        const job = await this.store.claim(this.owner, this.leaseMs);
        if (!job) break;
        const controller = new AbortController();
        this.active.set(job.id, controller);
        const task = this.execute(job, controller)
          .catch(() => {
            // Recovery scanner will reclaim a lease after a storage failure.
          })
          .finally(() => {
            this.active.delete(job.id);
            this.running.delete(task);
          });
        this.running.add(task);
      }
    } finally {
      this.polling = false;
    }
  }

  private async execute(
    job: BackgroundJob,
    controller: AbortController,
  ): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      await this.store.fail(job, {
        code: "NO_HANDLER",
        message: "No job handler registered",
        retryable: false,
      });
      return;
    }
    const heartbeat = setInterval(
      () => {
        void this.store
          .heartbeat(job, this.leaseMs)
          .then((valid) => {
            if (!valid) controller.abort();
          })
          .catch(() => controller.abort());
      },
      Math.max(50, Math.floor(this.leaseMs / 3)),
    );
    const timeout = setTimeout(() => controller.abort(), this.maxRunMs);
    try {
      const result = await Promise.race([
        handler(job.payload, {
          signal: controller.signal,
          reportProgress: async (progress, message) => {
            const valid = await this.store.progress(job, progress, message);
            if (!valid)
              throw new JobExecutionError("LEASE_LOST", "Job lease lost", true);
          },
        }),
        new Promise<never>((_resolve, reject) =>
          controller.signal.addEventListener("abort", () =>
            reject(
              new JobExecutionError(
                "LEASE_LOST",
                "Job lease lost or timed out",
                true,
              ),
            ),
          ),
        ),
      ]);
      await this.store.succeed(job, result);
    } catch (error) {
      await this.store.fail(job, classify(error));
    } finally {
      clearInterval(heartbeat);
      clearTimeout(timeout);
    }
  }
}
