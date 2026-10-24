# Local deployment

Use Node.js 24, pnpm 12.4.2, and PostgreSQL 17. `docker compose up --build -d` starts PostgreSQL, API, and the web application at http://localhost:8080. PostgreSQL is bound to 127.0.0.1:54328 and persists in the `postgres_data` volume. Local database defaults are development-only; set `DATAPHONE_DATABASE_PASSWORD` to change the password before first startup.

The first startup applies versioned SQL migrations. Demo mode creates sample users and workflows when `DATAPHONE_ENABLE_MOCK_CARRIER=true` and `DATAPHONE_SEED_DEMO=true`. The mock carrier is unavailable in production. See the README for demo accounts.

For native development, copy `.env.example` to `.env` only if you do not already have one. Set `DATAPHONE_PORT_ENCRYPTION_KEY` before starting the API: it is required in development as well as production. For a fresh database, generate a key with `openssl rand -base64 32` and save the result in `.env`. For an existing database, reuse its current deployment key instead of generating a replacement, or existing encrypted port data will be unreadable. When switching from Docker to a native API process against the same database, use the key configured in the Docker API container. Do not commit `.env`.

Load the environment into the process, run `pnpm install`, then `pnpm build`. Set `DATABASE_URL` to a named PostgreSQL database. Run `pnpm --filter @dataphone/api db:init`, `db:seed`, and `db:bootstrap-admin` with the bootstrap email/password environment variables. Start the API with `pnpm --filter @dataphone/api start` and the web dev server using the web workspace's dev script.

`GET /api/v1/health/live` checks the process; `/api/v1/health/ready` checks SQL connectivity and migrations. Use `docker compose ps` for container health. `docker compose down` preserves data. A volume reset discards all accounts and test records; the PostgreSQL switch intentionally starts with fresh data.

For integration tests, provide an isolated database owned by the test user:

```sh
DATAPHONE_TEST_DATABASE_URL=postgresql://dataphone:dataphone@127.0.0.1:54329/dataphone pnpm test
```

Each API suite creates a uniquely named `dataphone_*` schema and drops that schema on completion. The test role needs schema creation rights. The application never creates or drops a database. Use a dedicated test database. Integration suites are skipped when this variable is absent; a skipped run is not database verification.

Carrier secrets can be injected through the environment or an untracked `.env.carriers` file for Compose. See `docs/carriers/integration-requirements.md`. The application stores credential references, never carrier passwords.
