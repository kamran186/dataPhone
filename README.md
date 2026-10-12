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
MONGO_URI='mongodb://127.0.0.1:27018/dataphone?directConnection=true' pnpm --filter @dataphone/api start
pnpm --filter @dataphone/web dev
```

The MongoDB server must run as a replica set for later transaction and change-stream features. See [deployment notes](docs/deployment/local.md). For a local container run, use `docker compose up --build -d` and open `http://localhost:8080`.

When automatic demo seeding is disabled, initialize an administrator before staff can sign in. See the [local deployment instructions](docs/deployment/local.md) for the bootstrap command and secret handling.

The carrier adapter registry and tested mock are described in [carrier integration requirements](docs/carriers/integration-requirements.md). The only enabled real carrier capability is read-only Bandwidth inventory; live access requires DataPhone account credentials.

The [background jobs report](docs/implementation/phase-5-report.md) describes durable processing and live progress. The Jobs screen shows recent job status to authorized staff.

The [inventory report](docs/implementation/phase-6-report.md) describes carrier accounts, scheduled and manual synchronization, reconciliation, search, and exports. Add a carrier account with `POST /api/v1/carriers/{carrierId}/accounts` using an external account ID and an environment variable name as `credentialRef`. The sync endpoint takes the resulting **account ID**. Only Bandwidth read-only inventory is enabled for live carrier access; Peerless and BulkVS remain unavailable pending contracts.

The [customer and assignment report](docs/implementation/phase-7-report.md) describes customer records, number ownership, transfer history, and audited changes. Authorized staff can assign from a number detail page or select inventory rows for a bulk assignment.

The [purchase and disconnect report](docs/implementation/phase-8-report.md) describes availability search, idempotent multi-number orders, confirmed assignment, tracked disconnects, and live progress. Billable actions remain disabled; mock carrier capabilities were verified in tests.

The [port report](docs/implementation/phase-9-report.md) covers encrypted drafts and documents, mock order tracking, FOC, completion, and audit history. The [dashboard and reporting report](docs/implementation/phase-10-report.md) covers metrics and CSV/Excel exports. To exercise mock operations locally, set `DATAPHONE_ENABLE_MOCK_CARRIER=true` and configure a mock carrier account; production mode never enables the mock. Supply `DATAPHONE_PORT_ENCRYPTION_KEY` before creating a port draft.

### Development sample data

`docker compose up --build` now loads sample data on every API startup. The seed is repeatable: it creates one account for each role, three customers, a local mock carrier account, phone numbers and assignments, orders, ports with an encrypted sample document, completed and failed jobs, sync runs, and reconciliation issues. Existing demo records are retained on restart. It never overwrites a non-demo account with the same email or a non-demo record with the same customer ID or phone number.

Use `admin@email.com`, `operationsmanager@email.com`, `operationsstaff@email.com`, or `viewer@email.com` with the development password `Admin@123456`. These credentials are for local development only. To change the password before the first seed, set `DATAPHONE_DEMO_PASSWORD`; an existing demo account keeps its original password and startup reports a mismatch. Set `DATAPHONE_SEED_DEMO=false` to disable automatic seeding. Seeding is blocked when `NODE_ENV=production`.

To run it manually against the configured development database after building the API, use `DATAPHONE_ENABLE_MOCK_CARRIER=true DATAPHONE_DEMO_PASSWORD='Admin@123456' pnpm --filter @dataphone/api db:seed-demo`. The manual command also needs `MONGO_URI` and `DATAPHONE_PORT_ENCRYPTION_KEY`. In Docker Compose, `docker compose exec api node apps/api/dist/database/demo-cli.js` uses the already configured environment.

To inspect the Docker database in MongoDB Compass, connect to `mongodb://127.0.0.1:27018/dataphone?directConnection=true`, then open the `dataphone` database. The Docker MongoDB is bound to port 27018 on your Mac because a separate local MongoDB may already use port 27017. The Docker data persists in the `dataphone_mongo_data` volume.

For deployment and daily use, see the [production guide](docs/deployment/production.md), [backup and restore](docs/deployment/backup-restore.md), [operator guide](docs/operators/guide.md), [API guide](docs/api.md), and [carrier extension guide](docs/carriers/adding-adapter.md).

Quality checks: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm --filter @dataphone/web test:e2e`, and `pnpm build`.
