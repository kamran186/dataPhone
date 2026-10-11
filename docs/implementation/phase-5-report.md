# Phase 5 report: background jobs and live streaming

## Delivered

- Persistent job and event records with a unique idempotency key, canonical request fingerprint, and transactional queued event.
- Atomic claims, four-job worker concurrency, renewable 30-second leases, heartbeat checks, five-minute execution timeout, and recovery of expired claims by periodic scanning.
- Retryable and permanent failure classification, bounded exponential backoff, provider `Retry-After` support, structured failure records, and stale-worker write rejection.
- Transactional progress and completion events with monotonic per-job sequence numbers for loss-free replay across workers.
- Protected list, detail, and SSE endpoints under `/api/v1/jobs`, with persisted cursor replay and keepalive events.
- A permission-protected browser job view and an authenticated SSE client that reconnects with `Last-Event-ID`.

## Verification

The isolated MongoDB integration suite covers idempotent creation, concurrent claiming, lease expiry, stale writes, progress, retries, permanent failure, concurrency limits, periodic restart recovery, cursor replay, protected endpoints, and SSE delivery. The browser tests cover the job view and reconnecting stream client. The full suite passed: API 48/48 and web 5/5. Typecheck, lint, format check, build, Compose configuration validation, and production dependency audit passed; the audit found no known vulnerabilities. The web build reported a non-failing 661 kB chunk-size warning. Docker container smoke remains unavailable because of the local Docker Desktop daemon I/O failure.

## Design and limits

The API process runs the worker at startup. Set `DATAPHONE_JOB_WORKER_DISABLED=true` only for a process that should serve the API without claiming jobs, such as a test or a separate API tier. Polling is the durable recovery mechanism; change streams are not needed to meet the current one-second wakeup target. Handlers must be registered before worker startup, honor the abort signal, and use an idempotency key for any external side effect because an expired lease can be reclaimed after a crash. Job payloads should hold references rather than credentials or sensitive documents. `system.noop` is the only built-in handler; later phases add business handlers. No public job creation endpoint is exposed.

Docker container smoke remains blocked by the local Docker Desktop I/O failure documented in Phase 3.

## Task checklist

- [x] Implement persistent creation, idempotency, atomic claim, leases, heartbeat, and recovery scanning.
- [x] Implement bounded RxJS worker polling, concurrency, retry, backoff, progress, and structured failure.
- [x] Implement protected job list/detail/SSE endpoints and persisted event replay.
- [x] Implement browser job view and reconnecting authenticated SSE client.
- [x] Test execution, claims, retries, failures, recovery, lease expiry, SSE, reconnect, idempotency, and concurrency.
- [x] Record final native verification results.
- [ ] Verify container smoke when Docker Desktop is healthy.
