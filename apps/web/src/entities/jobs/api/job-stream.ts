import { useAuthStore } from "../../../app/model/use-auth-store";
export interface JobProgressEvent {
  jobId: string;
  type: "queued" | "started" | "progress" | "retry" | "succeeded" | "failed";
  progress?: number;
  message?: string;
  createdAt: string;
}
export type JobStreamState =
  "connecting" | "connected" | "reconnecting" | "complete" | "unavailable";
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      clearTimeout(timer);
      finish();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
function validEvent(value: unknown, jobId: string): value is JobProgressEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    event.jobId === jobId &&
    ["queued", "started", "progress", "retry", "succeeded", "failed"].includes(
      String(event.type),
    ) &&
    typeof event.createdAt === "string" &&
    (event.progress === undefined ||
      (typeof event.progress === "number" &&
        Number.isFinite(event.progress) &&
        event.progress >= 0 &&
        event.progress <= 100)) &&
    (event.message === undefined || typeof event.message === "string")
  );
}
export async function subscribeJobEvents(
  jobId: string,
  onEvent: (event: JobProgressEvent) => void,
  signal: AbortSignal,
  onState?: (state: JobStreamState) => void,
): Promise<void> {
  let lastId: string | undefined;
  let retryMs = 1_000;
  onState?.("connecting");
  while (!signal.aborted) {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const token = useAuthStore.getState().accessToken;
      const response = await fetch(
        `/api/v1/jobs/${encodeURIComponent(jobId)}/events`,
        {
          headers: {
            Accept: "text/event-stream",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(lastId ? { "Last-Event-ID": lastId } : {}),
          },
          credentials: "same-origin",
          signal,
        },
      );
      if (response.status === 401) {
        if (await useAuthStore.getState().refresh()) continue;
        if (!signal.aborted) onState?.("unavailable");
        return;
      }
      if (response.status === 403 || response.status === 404) {
        onState?.("unavailable");
        return;
      }
      if (!response.ok || !response.body)
        throw new Error(`Stream unavailable (${response.status})`);
      if (signal.aborted) return;
      onState?.("connected");
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer = (
          buffer + decoder.decode(chunk.value, { stream: true })
        ).replaceAll("\r\n", "\n");
        if (buffer.length > 65_536) throw new Error("Stream frame too large");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const id = frame.match(/^id:\s*(.+)$/m)?.[1];
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (id && data && id !== lastId) {
            let event: unknown;
            try {
              event = JSON.parse(data);
            } catch {
              /* A malformed frame must not advance the resume cursor. */
            }
            if (validEvent(event, jobId)) {
              lastId = id;
              retryMs = 1_000;
              onEvent(event);
              if (event.type === "succeeded" || event.type === "failed") {
                onState?.("complete");
                return;
              }
            }
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch {
      if (signal.aborted) return;
    } finally {
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          /* A failed transport may already be closed. */
        }
        reader.releaseLock();
      }
    }
    if (signal.aborted) return;
    onState?.("reconnecting");
    await wait(retryMs, signal);
    retryMs = Math.min(10_000, retryMs * 2);
  }
}
