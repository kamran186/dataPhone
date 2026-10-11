import "reflect-metadata";
import { ObjectId } from "mongodb";
import type { DatabaseService } from "../src/database/database.service";
import type { JobStore } from "../src/jobs/job.store";
import type { JobWorker } from "../src/jobs/job.worker";
import { PortJobs } from "../src/ports/port.jobs";
import type { PortOperations } from "../src/ports/port.operations";

it("requeues submitted ports after restart, with or without a native order ID", async () => {
  const first = new ObjectId(),
    second = new ObjectId();
  const toArray = async () => [
    { _id: first },
    { _id: second, nativeOrderId: "native-1" },
  ];
  const database = {
    ensureReady: async () => undefined,
    nativeDb: () => ({
      collection: () => ({ find: () => ({ limit: () => ({ toArray }) }) }),
    }),
  } as unknown as DatabaseService;
  const calls: Array<{
    type: string;
    payload: { portId: string };
    idempotencyKey: string;
  }> = [];
  const create = async (input: {
    type: string;
    payload: { portId: string };
    idempotencyKey: string;
  }) => {
    calls.push(input);
    return {};
  };
  const jobs = { create } as unknown as JobStore;
  const worker = { register: () => undefined } as unknown as JobWorker;
  const recovery = new PortJobs(database, jobs, {} as PortOperations, worker);
  await recovery.schedulePending(new Date("2026-10-11T17:00:00Z"));
  expect(calls).toContainEqual(
    expect.objectContaining({
      type: "port.submit",
      payload: { portId: first.toHexString() },
    }),
  );
  expect(calls).toContainEqual(
    expect.objectContaining({
      type: "port.track",
      payload: { portId: second.toHexString() },
    }),
  );
  expect(calls[0].idempotencyKey).not.toBe(calls[1].idempotencyKey);
});
