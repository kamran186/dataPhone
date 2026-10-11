# Phase 8 report: number search, purchase, and disconnect

## Delivered

- Carrier availability search accepts area code, city, state, and number pattern filters. Results normalize E.164 numbers and show carrier account, location, monthly price, setup price, and currency. One carrier error does not hide another carrier's offers.
- Protected purchase endpoints create durable, idempotent multi-number orders and queue their background jobs in the same MongoDB transaction. Orders expose queued, retrying, pending, completed, partial, and failed states. Pending carrier orders are tracked by follow-up jobs.
- Only confirmed numbers are added to inventory and assigned to the chosen customer. Purchase and assignment audit events are committed with ownership changes. Conflicting carrier claims open reconciliation issues and never transfer an existing number silently.
- Protected disconnect requests require the exact E.164 number as confirmation. An active-request unique index blocks duplicate pending disconnects. Carrier confirmation closes the holding and active customer assignment, marks the number disconnected, and records audit events in one transaction. Later inventory snapshots cannot silently reactivate a disconnected number.
- The browser provides offer comparison, customer selection, multi-number order submission, recent order status, live job progress, and a disconnect confirmation dialog with status tracking. It uses the existing protected job SSE stream.

## Verification

The isolated MongoDB suite covers multi-carrier normalization and timeout isolation, purchase idempotency, partial and failed orders, retryable carrier timeout, pending tracking, assignment after confirmation, conflicting number review, protected endpoints, disconnect confirmation, duplicate prevention, ownership closure, audit integrity, and inventory reappearance. The browser suite covers multi-number order submission and disconnect confirmation. The full suite passed: API 73/73 and web 13/13. Typecheck, lint, format check, build, Compose configuration, frozen-lockfile install, and production dependency audit passed. The audit found no known vulnerabilities. The web build reported a non-failing 713 kB chunk-size warning.

## Design and limits

The running carrier registry has no live purchase or disconnect adapter. The API additionally rejects any purchase or disconnect against a carrier other than `mock`. No billable carrier action was executed. Search and order processing were verified with deterministic mock carrier capabilities in tests; a real carrier implementation requires an authorized contract, credentials, sandbox acceptance, and separate approval before enablement. On a standard deployment without a mock account, the purchase screen can show no offers and cannot submit an order.

The order response contains its background job ID for live progress. Partial completion reports confirmed numbers and an unfulfilled count. Provider idempotency keys are reused on retries. The existing global audit chain still needs an external checkpoint for production tamper evidence. Docker Desktop container smoke remains pending because the host daemon has had an I/O error; configuration validates and native tests pass.

## Task checklist

- [x] Search area code, city/state, and pattern across capable carrier accounts with normalized prices.
- [x] Persist idempotent multi-number purchase orders and track pending, partial, retryable, and failed results.
- [x] Assign only confirmed numbers and audit purchase and ownership changes.
- [x] Require permission and literal confirmation for disconnect; track provider status and audit confirmed closure.
- [x] Provide browser purchase and disconnect workflows with SSE job progress.
- [x] Run API/browser suites, static gates, frozen install, dependency audit, and Compose validation.
- [ ] Verify Docker container smoke when Docker Desktop is healthy.
- [ ] Enable a real provider only after explicit authorization and contract/sandbox acceptance.
