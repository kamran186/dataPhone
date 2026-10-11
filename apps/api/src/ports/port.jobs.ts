import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { DatabaseService } from "../database/database.service";
import { JobStore } from "../jobs/job.store";
import { JobExecutionError, JobWorker } from "../jobs/job.worker";
import { PortOperations } from "./port.operations";

function portId(value: unknown): ObjectId {
  if (typeof value !== "string" || !/^[a-f\d]{24}$/i.test(value))
    throw new Error("Invalid port job ID");
  return new ObjectId(value);
}

@Injectable()
export class PortJobs implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly database: DatabaseService,
    private readonly jobs: JobStore,
    private readonly operations: PortOperations,
    worker: JobWorker,
  ) {
    worker.register("port.submit", async (payload, context) => {
      const result = await this.operations.process(
        portId(payload.portId),
        context,
      );
      if (result.status === "REJECTED")
        throw new JobExecutionError(
          "PORT_REJECTED",
          "Carrier rejected the port",
        );
      await context.reportProgress(95, "Port state recorded");
      return result;
    });
    worker.register("port.track", async (payload, context) => {
      const result = await this.operations.track(
        portId(payload.portId),
        context,
      );
      if (result.status === "REJECTED")
        throw new JobExecutionError(
          "PORT_REJECTED",
          "Carrier rejected the port",
        );
      await context.reportProgress(95, "Carrier status recorded");
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
    const slot = Math.floor(now.getTime() / (10 * 60_000));
    const ports = await this.database
      .nativeDb()
      .collection("port_requests")
      .find(
        {
          status: { $in: ["SUBMITTED", "DATE_CONFIRMED"] },
          nativeOrderId: { $exists: true },
        },
        { projection: { _id: 1 } },
      )
      .limit(1000)
      .toArray();
    for (const port of ports)
      await this.jobs.create({
        type: "port.track",
        payload: { portId: port._id.toHexString() },
        idempotencyKey: `port-recover:${port._id.toHexString()}:${slot}`,
        maxAttempts: 5,
      });
  }
}
