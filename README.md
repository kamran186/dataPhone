# DataPhone

Internal DID inventory and inbound porting platform for DataPhone. This repository is being delivered in sequential phases; see [implementation progress](docs/implementation/PROGRESS.md) for verified status.

## Phase 0 feasibility probe

Requirements: Node.js 24, pnpm 12, and an isolated MongoDB replica set. The test creates and removes a uniquely named temporary database.

```sh
pnpm install
DATAPHONE_TEST_MONGO_URL='mongodb://127.0.0.1:27186/?replicaSet=rs_dataphone_phase0' pnpm test:feasibility
```

Do not point this probe at a production database. The URL must have access to create and drop its own `dataphone_feasibility_*` database. Without the URL, MongoDB tests are reported as skipped.

See [the architecture](docs/architecture/system.md) and [the feasibility report](docs/implementation/phase-0-report.md) before implementing business features.

## Run the application

The application has employee sign-in and permission-protected foundation screens. Carrier data and business workflows are delivered in later phases. Keep this local build on a private machine.

```sh
pnpm install
pnpm build
MONGO_URI='mongodb://127.0.0.1:27017/dataphone?directConnection=true' pnpm --filter @dataphone/api start
pnpm --filter @dataphone/web dev
```

The MongoDB server must run as a replica set for later transaction and change-stream features. See [deployment notes](docs/deployment/local.md). For a local container run, use `docker compose up --build -d` and open `http://localhost:8080`.

An administrator must be initialized once before staff can sign in. See the [local deployment instructions](docs/deployment/local.md) for the bootstrap command and secret handling.

The carrier adapter registry and tested mock are described in [carrier integration requirements](docs/carriers/integration-requirements.md). The only enabled real carrier capability is read-only Bandwidth inventory; live access requires DataPhone account credentials.

Quality checks: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, and `pnpm build`.
