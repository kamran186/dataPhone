# DataPhone

Internal DID inventory and inbound porting proof of concept for DataPhone. All implementation phases are tracked in [implementation progress](docs/implementation/PROGRESS.md).

## Phase 0 feasibility probe

Requirements: Node.js 24, pnpm 12, and an isolated MongoDB replica set. The test creates and removes a uniquely named temporary database.

```sh
pnpm install
DATAPHONE_TEST_MONGO_URL='mongodb://127.0.0.1:27186/?replicaSet=rs_dataphone_phase0' pnpm test:feasibility
```

Do not point this probe at a production database. The URL must have access to create and drop its own `dataphone_feasibility_*` database. Without the URL, MongoDB tests are reported as skipped.

See [the architecture](docs/architecture/system.md) and [the feasibility report](docs/implementation/phase-0-report.md) before implementing business features.

## Run the application

The application has employee sign-in, permission-protected pages, background jobs, unified number inventory, mock purchasing and porting, dashboards, and reports. Keep this local build on a private machine.

```sh
pnpm install
pnpm build
MONGO_URI='mongodb://127.0.0.1:27017/dataphone?directConnection=true' pnpm --filter @dataphone/api start
pnpm --filter @dataphone/web dev
```

The MongoDB server must run as a replica set for later transaction and change-stream features. See [deployment notes](docs/deployment/local.md). For a local container run, use `docker compose up --build -d` and open `http://localhost:8080`.

An administrator must be initialized once before staff can sign in. See the [local deployment instructions](docs/deployment/local.md) for the bootstrap command and secret handling.

The carrier adapter registry and tested mock are described in [carrier integration requirements](docs/carriers/integration-requirements.md). The only enabled real carrier capability is read-only Bandwidth inventory; live access requires DataPhone account credentials.

The [background jobs report](docs/implementation/phase-5-report.md) describes durable processing and live progress. The Jobs screen shows recent job status to authorized staff.

The [inventory report](docs/implementation/phase-6-report.md) describes carrier accounts, scheduled and manual synchronization, reconciliation, search, and exports. Add a carrier account with `POST /api/v1/carriers/{carrierId}/accounts` using an external account ID and an environment variable name as `credentialRef`. The sync endpoint takes the resulting **account ID**. Only Bandwidth read-only inventory is enabled for live carrier access; Peerless and BulkVS remain unavailable pending contracts.

The [customer and assignment report](docs/implementation/phase-7-report.md) describes customer records, number ownership, transfer history, and audited changes. Authorized staff can assign from a number detail page or select inventory rows for a bulk assignment.

The [purchase and disconnect report](docs/implementation/phase-8-report.md) describes availability search, idempotent multi-number orders, confirmed assignment, tracked disconnects, and live progress. Billable actions remain disabled; mock carrier capabilities were verified in tests.

The [port report](docs/implementation/phase-9-report.md) covers encrypted drafts and documents, mock order tracking, FOC, completion, and audit history. The [dashboard and reporting report](docs/implementation/phase-10-report.md) covers metrics and CSV/Excel exports. To exercise mock operations locally, set `DATAPHONE_ENABLE_MOCK_CARRIER=true` and configure a mock carrier account; production mode never enables the mock. Supply `DATAPHONE_PORT_ENCRYPTION_KEY` before creating a port draft.

For deployment and daily use, see the [production guide](docs/deployment/production.md), [backup and restore](docs/deployment/backup-restore.md), [operator guide](docs/operators/guide.md), [API guide](docs/api.md), and [carrier extension guide](docs/carriers/adding-adapter.md).

Quality checks: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm --filter @dataphone/web test:e2e`, and `pnpm build`.
