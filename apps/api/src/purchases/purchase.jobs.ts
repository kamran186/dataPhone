import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Id, uuid } from "../database/query";
import { DatabaseService } from "../database/database.service";
import { JobStore } from "../jobs/job.store";
import { JobExecutionError, JobWorker } from "../jobs/job.worker";
import { DisconnectService } from "./disconnect.service";
import { PurchaseOrdersService } from "./purchase-orders.service";

function payloadId(value: unknown): Id {
  if (
    typeof value !== "string" ||
    !/^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(
      value,
    )
  )
    throw new Error("Invalid purchase job ID");
  return uuid(value);
}

@Injectable()
export class PurchaseJobs implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly database: DatabaseService,
    private readonly jobs: JobStore,
    private readonly orders: PurchaseOrdersService,
    private readonly disconnects: DisconnectService,
    worker: JobWorker,
  ) {
    worker.register("purchase.execute", async (payload, context) => {
      const result = await this.orders.process(
        payloadId(payload.orderId),
        context,
      );
      if (result.status === "failed")
        throw new JobExecutionError(
          "PURCHASE_FAILED",
          "Carrier purchase failed",
        );
      await context.reportProgress(95, "Purchase state recorded");
      return result;
    });
    worker.register("purchase.track", async (payload, context) => {
      const result = await this.orders.track(
        payloadId(payload.orderId),
        context,
      );
      if (result.status === "failed")
        throw new JobExecutionError(
          "PURCHASE_FAILED",
          "Carrier purchase failed",
        );
      await context.reportProgress(95, "Carrier purchase status recorded");
      return result;
    });
    worker.register("disconnect.execute", async (payload, context) => {
      const result = await this.disconnects.process(
        payloadId(payload.requestId),
        context,
      );
      if (result.status === "failed")
        throw new JobExecutionError(
          "DISCONNECT_FAILED",
          "Carrier disconnect failed",
        );
      await context.reportProgress(95, "Disconnect state recorded");
      return result;
    });
    worker.register("disconnect.track", async (payload, context) => {
      const result = await this.disconnects.track(
        payloadId(payload.requestId),
        context,
      );
      if (result.status === "failed")
        throw new JobExecutionError(
          "DISCONNECT_FAILED",
          "Carrier disconnect failed",
        );
      await context.reportProgress(95, "Carrier disconnect status recorded");
      return result;
    });
  }

  onModuleInit(): void {
    if (process.env.DATAPHONE_JOB_WORKER_DISABLED === "true") return;
    this.timer = setInterval(() => {
      void this.schedulePending().catch(() => undefined);
    }, 10 * 60_000);
    this.timer.unref();
    void this.schedulePending().catch(() => undefined);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async schedulePending(now = new Date()): Promise<void> {
    await this.database.ensureReady();
    const db = this.database.sql();
    const slot = Math.floor(now.getTime() / (10 * 60_000));
    const purchases = await db
      .table("purchase_orders")
      .find(
        { status: "pending", nativeOrderId: { $exists: true } },
        { projection: { id: 1 } },
      )
      .limit(1000)
      .toArray();
    const disconnects = await db
      .table("disconnect_requests")
      .find(
        { status: "pending", nativeOrderId: { $exists: true } },
        { projection: { id: 1 } },
      )
      .limit(1000)
      .toArray();
    for (const order of purchases)
      await this.jobs.create({
        type: "purchase.track",
        payload: { orderId: order.id },
        idempotencyKey: `purchase-recover:${order.id}:${slot}`,
        maxAttempts: 5,
      });
    for (const request of disconnects)
      await this.jobs.create({
        type: "disconnect.track",
        payload: { requestId: request.id },
        idempotencyKey: `disconnect-recover:${request.id}:${slot}`,
        maxAttempts: 5,
      });
  }
}
