import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { JobStore } from "../jobs/job.store";
import { JobWorker } from "../jobs/job.worker";
import { InventoryService } from "./inventory.service";

@Injectable()
export class InventoryJobs implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly inventory: InventoryService,
    private readonly jobs: JobStore,
    worker: JobWorker,
  ) {
    worker.register("inventory.sync", async (payload, context) => {
      const accountId = payload.accountId;
      if (typeof accountId !== "string" || !/^[a-f\d]{24}$/i.test(accountId))
        throw new Error("Invalid inventory sync account");
      await context.reportProgress(5, "Reading carrier inventory");
      const run = await this.inventory.sync(
        new ObjectId(accountId),
        context.signal,
      );
      await context.reportProgress(95, "Reconciliation complete");
      return {
        syncRunId: run._id.toHexString(),
        seen: run.seen,
        created: run.created,
        updated: run.updated,
        missing: run.missing,
        issues: run.issues,
      };
    });
  }

  onModuleInit(): void {
    if (process.env.DATAPHONE_JOB_WORKER_DISABLED === "true") return;
    this.timer = setInterval(() => {
      void this.schedule().catch(() => undefined);
    }, 60 * 60_000);
    this.timer.unref();
    void this.schedule().catch(() => undefined);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async schedule(now = new Date()): Promise<void> {
    const hour = now.toISOString().slice(0, 13);
    const carriers = await this.inventory.listCarriers();
    for (const carrier of carriers) {
      if (!carrier.capabilities.includes("inventory.list")) continue;
      for (const account of carrier.accounts) {
        if (account.status !== "active") continue;
        await this.jobs.create({
          type: "inventory.sync",
          payload: { accountId: account.id },
          idempotencyKey: `inventory.sync:${account.id}:${hour.replaceAll("-", "").replace("T", "")}`,
          maxAttempts: 3,
        });
      }
    }
  }
}
