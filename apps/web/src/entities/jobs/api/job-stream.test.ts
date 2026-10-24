import { afterEach, expect, it, vi } from "vitest";
import { useAuthStore } from "../../../app/model/use-auth-store";
import { subscribeJobEvents, type JobProgressEvent } from "./job-stream";

function stream(frame: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frame));
      controller.close();
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

it("reconnects with the last persisted event ID and stops on completion", async () => {
  useAuthStore.setState({ accessToken: "test-token" });
  const calls: Array<{ headers: Record<string, string> }> = [];
  const fetcher = vi.fn(
    async (_url: string, init: { headers: Record<string, string> }) => {
      calls.push(init);
      const terminal = calls.length === 2;
      const id = terminal ? "2" : "1";
      const event = {
        jobId: "job-1",
        type: terminal ? "succeeded" : "progress",
        progress: terminal ? 100 : 50,
        createdAt: "2026-10-11T00:00:00Z",
      };
      return {
        ok: true,
        status: 200,
        body: stream(
          `id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        ),
      };
    },
  );
  vi.stubGlobal("fetch", fetcher);
  const events: JobProgressEvent[] = [];
  await subscribeJobEvents(
    "job-1",
    (event) => events.push(event),
    new AbortController().signal,
  );
  expect(events.map((event) => event.type)).toEqual(["progress", "succeeded"]);
  expect(calls[0].headers.Authorization).toBe("Bearer test-token");
  expect(calls[1].headers["Last-Event-ID"]).toBe("1");
});

it("ignores malformed or unrelated events without advancing the resume cursor", async () => {
  const events: JobProgressEvent[] = [];
  const valid = {
    jobId: "job-1",
    type: "succeeded",
    progress: 100,
    createdAt: "2026-10-24T09:00:00Z",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      body: stream(
        [
          "id: 1\ndata: not-json\n\n",
          `id: 2\ndata: ${JSON.stringify({ ...valid, jobId: "other-job" })}\n\n`,
          `id: 3\ndata: ${JSON.stringify({ ...valid, progress: -5 })}\n\n`,
          `id: 4\ndata: ${JSON.stringify(valid)}\n\n`,
        ].join(""),
      ),
    })),
  );
  const states: string[] = [];
  await subscribeJobEvents(
    "job-1",
    (event) => events.push(event),
    new AbortController().signal,
    (state) => states.push(state),
  );
  expect(events).toEqual([valid]);
  expect(states).toEqual(["connecting", "connected", "complete"]);
});

it("stops reconnecting when the operator cannot access the job", async () => {
  const request = vi.fn(async () => ({ ok: false, status: 403 }));
  vi.stubGlobal("fetch", request);
  const states: string[] = [];
  await subscribeJobEvents(
    "restricted-job",
    vi.fn(),
    new AbortController().signal,
    (state) => states.push(state),
  );
  expect(request).toHaveBeenCalledTimes(1);
  expect(states).toEqual(["connecting", "unavailable"]);
});
