import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { bootstrapAdministrator } from "../src/auth/bootstrap-admin";
import { createApp } from "../src/bootstrap";
import { loadConfig } from "../src/config/app-config";
import { DatabaseService } from "../src/database/database.service";
import { JobStore } from "../src/jobs/job.store";
import { JobExecutionError, JobWorker } from "../src/jobs/job.worker";

const baseUrl = process.env.DATAPHONE_TEST_MONGO_URL;
const integration = baseUrl ? describe : describe.skip;

async function until(
  check: () => Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for job state");
}

integration("persistent job processing", () => {
  let database: DatabaseService;
  let store: JobStore;
  let testUri: string;

  beforeAll(async () => {
    const url = new URL(baseUrl ?? "mongodb://127.0.0.1:27017/");
    url.pathname = `/dataphone_phase5_test_${randomUUID().replaceAll("-", "")}`;
    testUri = url.toString();
    database = new DatabaseService(
      loadConfig({ MONGO_URI: testUri, NODE_ENV: "test" }),
    );
    await database.ensureReady();
    store = new JobStore(database);
  });

  beforeEach(async () => {
    await database.nativeDb().collection("background_jobs").deleteMany({});
    await database.nativeDb().collection("job_events").deleteMany({});
  });

  afterAll(async () => {
    if (database?.isConnected()) await database.nativeDb().dropDatabase();
    await database?.close();
  });

  it("persists one job for a repeated idempotency key and detects changed input", async () => {
    const input = {
      type: "system.noop",
      payload: { b: 2, a: 1 },
      idempotencyKey: "same-request-001",
    };
    const first = await store.create(input);
    const again = await store.create({ ...input, payload: { a: 1, b: 2 } });
    expect(again._id.toHexString()).toBe(first._id.toHexString());
    expect(
      await database.nativeDb().collection("background_jobs").countDocuments(),
    ).toBe(1);
    expect(
      (await store.listEvents(first._id)).map((event) => event.type),
    ).toEqual(["queued"]);
    await expect(store.create({ ...input, payload: { a: 3 } })).rejects.toThrow(
      "different job",
    );
  });

  it("allows only one atomic claimant and rejects stale lease writes", async () => {
    const created = await store.create({ type: "system.noop", payload: {} });
    const claimed = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        store.claim(`worker-${index}`, 1_000),
      ),
    );
    expect(claimed.filter(Boolean)).toHaveLength(1);
    const first = claimed.find(Boolean)!;
    expect(first._id.toHexString()).toBe(created._id.toHexString());
    expect(first.attempts).toBe(1);
    expect(await store.heartbeat(first, 1_000)).toBe(true);
    await database
      .nativeDb()
      .collection("background_jobs")
      .updateOne({ _id: first._id }, { $set: { leaseUntil: new Date(0) } });
    expect(await store.heartbeat(first, 1_000)).toBe(false);
    expect(await store.succeed(first, { stale: true })).toBe(false);
    const recovered = await store.claim("recovery-worker", 1_000);
    expect(recovered?.attempts).toBe(2);
    expect(await store.succeed(first, { stale: true })).toBe(false);
    expect(await store.succeed(recovered!, { ok: true })).toBe(true);
    expect((await store.get(created._id))?.status).toBe("succeeded");
  });

  it("runs a handler, stores monotonic progress, and reports final events", async () => {
    const worker = new JobWorker(store);
    worker.register("test.progress", async (_payload, context) => {
      await context.reportProgress(25, "First step");
      await context.reportProgress(75, "Second step");
      return { count: 2 };
    });
    const job = await store.create({ type: "test.progress", payload: {} });
    await worker.tick();
    await until(async () => (await store.get(job._id))?.status === "succeeded");
    const final = await store.get(job._id);
    expect(final).toMatchObject({
      progress: 100,
      result: { count: 2 },
      attempts: 1,
    });
    expect(
      (await store.listEvents(job._id)).map((event) => event.type),
    ).toEqual(["queued", "started", "progress", "progress", "succeeded"]);
    await worker.onModuleDestroy();
  });

  it("retries with backoff and then succeeds", async () => {
    const worker = new JobWorker(store);
    let calls = 0;
    worker.register("test.retry", async () => {
      calls += 1;
      if (calls === 1)
        throw new JobExecutionError("TEMPORARY", "Try later", true, 5_000);
      return { ok: true };
    });
    const job = await store.create({
      type: "test.retry",
      payload: {},
      maxAttempts: 2,
    });
    await worker.tick();
    await until(
      async () =>
        (await store.get(job._id))?.status === "queued" &&
        (await store.get(job._id))?.attempts === 1,
    );
    const retry = await store.get(job._id);
    expect(
      retry!.runAt.getTime() - retry!.updatedAt.getTime(),
    ).toBeGreaterThanOrEqual(5_000);
    await database
      .nativeDb()
      .collection("background_jobs")
      .updateOne({ _id: job._id }, { $set: { runAt: new Date(0) } });
    await worker.tick();
    await until(async () => (await store.get(job._id))?.status === "succeeded");
    expect((await store.get(job._id))?.attempts).toBe(2);
    expect(
      (await store.listEvents(job._id)).map((event) => event.type),
    ).toContain("retry");
    await worker.onModuleDestroy();
  });

  it("records structured permanent failures and missing handlers", async () => {
    const worker = new JobWorker(store);
    const job = await store.create({ type: "test.no-handler", payload: {} });
    await worker.tick();
    await until(async () => (await store.get(job._id))?.status === "failed");
    expect((await store.get(job._id))?.failure).toMatchObject({
      code: "NO_HANDLER",
      retryable: false,
    });
    expect((await store.listEvents(job._id)).at(-1)?.type).toBe("failed");
    await worker.onModuleDestroy();
  });

  it("limits active execution to four jobs", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const worker = new JobWorker(store);
    worker.register("test.gated", async () => {
      await gate;
      return { ok: true };
    });
    for (let index = 0; index < 6; index += 1)
      await store.create({ type: "test.gated", payload: { index } });
    await worker.tick();
    expect(
      await database
        .nativeDb()
        .collection("background_jobs")
        .countDocuments({ status: "running" }),
    ).toBe(4);
    expect(
      await database
        .nativeDb()
        .collection("background_jobs")
        .countDocuments({ status: "queued" }),
    ).toBe(2);
    release();
    await until(
      async () =>
        (await database
          .nativeDb()
          .collection("background_jobs")
          .countDocuments({ status: "succeeded" })) === 4,
    );
    await worker.tick();
    await until(
      async () =>
        (await database
          .nativeDb()
          .collection("background_jobs")
          .countDocuments({ status: "succeeded" })) === 6,
    );
    await worker.onModuleDestroy();
  });

  it("periodically reclaims expired work after a worker restart", async () => {
    const job = await store.create({ type: "test.recovered", payload: {} });
    const abandoned = await store.claim("old-process", 1_000);
    expect(abandoned?._id).toEqual(job._id);
    await database
      .nativeDb()
      .collection("background_jobs")
      .updateOne({ _id: job._id }, { $set: { leaseUntil: new Date(0) } });
    const worker = new JobWorker(store);
    worker.register("test.recovered", async () => ({ recovered: true }));
    const previous = process.env.DATAPHONE_JOB_WORKER_DISABLED;
    process.env.DATAPHONE_JOB_WORKER_DISABLED = "false";
    try {
      worker.onModuleInit();
      await until(
        async () => (await store.get(job._id))?.status === "succeeded",
        3_000,
      );
      expect((await store.get(job._id))?.attempts).toBe(2);
    } finally {
      await worker.onModuleDestroy();
      if (previous === undefined)
        delete process.env.DATAPHONE_JOB_WORKER_DISABLED;
      else process.env.DATAPHONE_JOB_WORKER_DISABLED = previous;
    }
  });

  it("replays events after a persisted cursor", async () => {
    const job = await store.create({ type: "system.noop", payload: {} });
    const claimed = await store.claim("cursor-test", 1_000);
    expect(claimed?._id).toEqual(job._id);
    const first = (await store.listEvents(job._id))[0];
    const replay = await store.listEvents(job._id, first.sequence);
    expect(replay.map((event) => event.type)).toEqual(["started"]);
  });

  it("protects job endpoints and streams persisted SSE events", async () => {
    const previousUri = process.env.MONGO_URI;
    const previousSecret = process.env.JWT_SECRET;
    const previousWorker = process.env.DATAPHONE_JOB_WORKER_DISABLED;
    process.env.MONGO_URI = testUri;
    process.env.JWT_SECRET = "phase5-test-secret-with-at-least-32-bytes";
    process.env.DATAPHONE_JOB_WORKER_DISABLED = "true";
    let app: INestApplication | undefined;
    try {
      app = await createApp();
      await app.listen(0, "127.0.0.1");
      const address = app.getHttpServer().address() as { port: number };
      const root = `http://127.0.0.1:${address.port}/api/v1`;
      const job = await store.create({ type: "system.noop", payload: {} });
      expect((await fetch(`${root}/jobs`)).status).toBe(401);
      await bootstrapAdministrator(
        app.get(DatabaseService),
        "jobs-admin@example.test",
        "phase5 secure administrator passphrase",
      );
      const login = await fetch(`${root}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "jobs-admin@example.test",
          password: "phase5 secure administrator passphrase",
        }),
      });
      expect(login.status).toBe(201);
      const { accessToken } = (await login.json()) as { accessToken: string };
      const headers = { Authorization: `Bearer ${accessToken}` };
      const list = await fetch(`${root}/jobs`, { headers });
      expect(list.status).toBe(200);
      expect(
        ((await list.json()) as { items: Array<{ id: string }> }).items[0].id,
      ).toBe(job._id.toHexString());
      const detail = await fetch(`${root}/jobs/${job._id.toHexString()}`, {
        headers,
      });
      expect(detail.status).toBe(200);
      const abort = new AbortController();
      const response = await fetch(
        `${root}/jobs/${job._id.toHexString()}/events`,
        {
          headers,
          signal: abort.signal,
        },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      try {
        const reader = response.body!.getReader();
        let received = "";
        for (
          let index = 0;
          index < 5 && !received.includes("queued");
          index += 1
        ) {
          const next = await reader.read();
          received += new TextDecoder().decode(next.value);
        }
        expect(received).toContain("queued");
      } finally {
        abort.abort();
      }
    } finally {
      await app?.close();
      if (previousUri === undefined) delete process.env.MONGO_URI;
      else process.env.MONGO_URI = previousUri;
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
      if (previousWorker === undefined)
        delete process.env.DATAPHONE_JOB_WORKER_DISABLED;
      else process.env.DATAPHONE_JOB_WORKER_DISABLED = previousWorker;
    }
  });
});
