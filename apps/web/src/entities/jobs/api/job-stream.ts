import { useAuthStore } from "../../../app/model/use-auth-store";

export interface JobProgressEvent {
  jobId: string;
  type: "queued" | "started" | "progress" | "retry" | "succeeded" | "failed";
  progress?: number;
  message?: string;
  createdAt: string;
}

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

export async function subscribeJobEvents(
  jobId: string,
  onEvent: (event: JobProgressEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  let lastId: string | undefined;
  let retryMs = 1_000;
  while (!signal.aborted) {
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
      if (response.status === 401 && (await useAuthStore.getState().refresh()))
        continue;
      if (!response.ok || !response.body)
        throw new Error(`Stream unavailable (${response.status})`);
      retryMs = 1_000;
      const reader = response.body.getReader();
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
          const data = frame.match(/^data:\s*(.+)$/m)?.[1];
          if (id && data) {
            try {
              const event = JSON.parse(data) as JobProgressEvent;
              lastId = id;
              onEvent(event);
              if (event.type === "succeeded" || event.type === "failed") {
                void reader.cancel().catch(() => undefined);
                return;
              }
            } catch {
              // Ignore an invalid frame; the next persisted event can still be read.
            }
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch {
      if (signal.aborted) return;
    }
    if (signal.aborted) return;
    await wait(retryMs, signal);
    retryMs = Math.min(10_000, retryMs * 2);
  }
}
