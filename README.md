# DataPhone

Internal DID inventory and inbound porting application built with React, NestJS, and PostgreSQL 17. It provides employee sign-in and permissions, unified number inventory, customer ownership and audit history, jobs with live progress, encrypted port documents, reports, and simulated purchase/port workflows.

## Run locally

Use Node.js 24, pnpm 12.4.2, and Docker Compose:

```sh
pnpm install
docker compose up --build -d
```

Open http://localhost:8080. PostgreSQL persists in the `postgres_data` volume and is available locally on port 54328. The application initializes a fresh PostgreSQL schema and reproducible development seeds. See [local deployment](docs/deployment/local.md) for native development, environment variables, administrator bootstrap, and database initialization.

Development demo seeding is repeatable and creates four users: `admin@email.com`, `operationsmanager@email.com`, `operationsstaff@email.com`, and `viewer@email.com`, all initially using `Admin@123456`. Set `DATAPHONE_DEMO_PASSWORD` before the first seed to choose another password. Existing passwords are preserved. Demo and mock modes are disabled in production.

## Carrier integration

Peerless SOAP, BulkVS REST, and Bandwidth Numbers API v2 expose **inventory and available-number search**. Configure account IDs and credential references using the carrier account API, then inject test credentials through the environment or an untracked `.env.carriers` file for Compose. See the [carrier guide](docs/carriers/integration-requirements.md). No client test credentials have been provided, so live account acceptance remains pending.

The **Search numbers** page is available to inventory viewers. It shows each carrier's supported results, unsupported-filter errors, and partial search coverage. BulkVS supports area-code search by discovering NPA/NXX exchanges. Purchases, disconnects, and port submissions execute only against the local mock carrier. Live operations that incur charges remain disabled.

## Verification

```sh
pnpm typecheck
pnpm lint
pnpm format:check
DATAPHONE_TEST_DATABASE_URL=postgresql://dataphone:dataphone@127.0.0.1:54329/dataphone pnpm test
pnpm build
pnpm --filter @dataphone/web test:e2e
```

Database suites use separate temporary PostgreSQL schemas and need a dedicated test database with schema creation rights. Without `DATAPHONE_TEST_DATABASE_URL`, integration tests are skipped. `pnpm test:feasibility` runs the PostgreSQL persistence checks.

See the [database design](docs/architecture/database.md), [operator guide](docs/operators/guide.md), [API guide](docs/api.md), [production deployment](docs/deployment/production.md), [backup/restore](docs/deployment/backup-restore.md), and [adding a carrier](docs/carriers/adding-adapter.md).
