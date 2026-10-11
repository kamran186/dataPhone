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
