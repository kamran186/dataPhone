# PostgreSQL and carrier read integration delivery

Verified on October 21, 2026. Delivery branch: `codex/scope1-review`, based on `Prod`. Merge target: local `Prod`.

## Delivered

- PostgreSQL 17 is the primary database. The `pg` repository uses typed SQL columns, parameter binding, versioned migrations, UUID identities, foreign keys, uniqueness constraints, and serializable transactions with bounded retries.
- Authentication and refresh rotation, customer ownership, history, inventory reconciliation, simulated purchases/disconnects/ports, durable jobs, reports, and encrypted documents run on PostgreSQL. Jobs use row claims with `FOR UPDATE SKIP LOCKED`; document bytes and audit writes share a transaction. Audit hashing canonicalizes JSON dates and key order.
- Peerless SOAP inventory and search use the supplied WSDL contracts. BulkVS uses REST inventory and bounded exchange discovery/search. Bandwidth uses JSON Numbers API v2 inventory and availability search. Live adapters expose only read capabilities.
- Inventory viewers can use the new Search numbers page. Results include unsupported-filter and partial-coverage outcomes. Purchasing remains permission protected and live write operations remain disabled.
- Compose, environment examples, initialization/seeding, health checks, deployment, backup/restore, API, and operator notes now describe PostgreSQL.

## Verification evidence

| Check | Result |
| --- | --- |
| API suites against isolated PostgreSQL schemas | 17 suites, 95 tests passed; no skipped integration suites |
| Browser component suites | 5 files, 19 tests passed |
| Chrome workflows | 2 passed |
| Typecheck, lint, formatting, whitespace check | Passed |
| Production API and web build | Passed; existing frontend bundle-size warning remains |
| Repository source/configuration/documentation scan | PostgreSQL is the only database implementation and documentation; obsolete plans and database resources removed |
| Final Compose build/start | PostgreSQL, API, and web started successfully; database healthy |
| Packaged application HTTP smoke | Readiness, login/refresh, UUIDs, inventory, reports/CSV, customer/port lists, document download, viewer search, and viewer purchase rejection passed |
| Running application audit verification | Valid chain, 7 events at verification |
| Audit JSON round-trip regression | Ownership suite: 9 tests passed after adding a date-bearing event |

The running development application contained 17 numbers, three customers, four port records, and an encrypted sample document during the smoke test. One sample port completed through the real application worker against the local simulated carrier; this is not live carrier acceptance.

## Remaining external validation

The client has not supplied carrier test credentials. No live Peerless, BulkVS, or Bandwidth account call was made. Contract tests cannot confirm account permissions, Peerless endpoint reachability/status semantics, BulkVS authentication format or inventory completeness for a large account, or actual carrier availability. Follow the acceptance steps in `docs/carriers/integration-requirements.md` when the credentials arrive. Keep live purchasing, disconnecting, and port submission disabled.

The original full POC's live write workflows, carrier-sourced acquisition/location metadata, and fuller carrier-change history remain later work. A privileged database owner can alter history; independent audit checkpoints are still required for privileged tamper detection.
