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
