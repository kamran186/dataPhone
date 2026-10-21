# Production deployment

Deploy the NestJS API/worker and React frontend behind HTTPS with a private PostgreSQL 17 database. The Compose configuration is for local development. Set `NODE_ENV=production`, `DATABASE_URL`, the exact HTTPS `CORS_ORIGIN`, a stable `JWT_SECRET` of at least 32 bytes, and `DATAPHONE_PORT_ENCRYPTION_KEY` as a random 32-byte base64 key. Store secrets outside Git. Configure database TLS through the PostgreSQL connection URL for the chosen host.

Build with `pnpm build`; apply migrations using `pnpm --filter @dataphone/api db:init`; seed roles with `db:seed`. Create the first administrator through `db:bootstrap-admin` using `DATAPHONE_BOOTSTRAP_EMAIL` and `DATAPHONE_BOOTSTRAP_PASSWORD`. Migrations are also checked during API readiness. Use a schema owner for deployments and limit the runtime database user's rights to required tables. Keep the database private and back up the database and encryption key separately.

Start `pnpm --filter @dataphone/api start`. Proxy `/api` to the API and serve `apps/web/dist`. Workers run with the API unless `DATAPHONE_JOB_WORKER_DISABLED=true`; only disable them when another worker is running. Persisted leases and event cursors recover after restart. Mock/demo mode is disabled in production.

Live carrier capabilities are inventory and available-number search. Purchasing, disconnecting, and port submission remain disabled for live carriers. Before claiming provider acceptance, validate each configured account using its test credentials and compare complete inventory counts with the carrier portal. Contract fixtures verify implementation behavior but cannot establish actual account permissions or provider status semantics.
