# Local deployment

## Compose

Run `docker compose up --build -d` from the repository root, then open `http://localhost:8080`. The web port is bound to `127.0.0.1`; MongoDB and API stay on the private Compose network. `mongo-init` initializes a single-node replica set named `rs0` and exits. MongoDB data persists in the `mongo_data` volume.

Use `docker compose ps` to check service health. `GET http://localhost:8080/api/v1/health/live` checks the API process; `/api/v1/health/ready` checks MongoDB connectivity. `docker compose down` stops the stack while preserving the volume. `docker compose down -v` deletes the local MongoDB volume and should only be used when its data is disposable.

The local Compose stack uses development mode and creates an in-memory JWT signing key at each API start unless `JWT_SECRET` is supplied. Existing access tokens then expire on restart; refresh sessions can issue new access tokens. Set a stable secret of at least 32 bytes for any multi-instance or persistent deployment. Production mode refuses to start without it. Port requests and encrypted document upload also require `DATAPHONE_PORT_ENCRYPTION_KEY`, a stable base64-encoded 32-byte random key. Keep it in a secret manager, pass it to the API environment, and back it up separately; losing it makes stored port credentials and documents unreadable. The local web port stays bound to loopback. This stack is for local validation; a single-node replica set has no node failure tolerance.

To exercise simulated purchases, disconnects, and ports, set `DATAPHONE_ENABLE_MOCK_CARRIER=true` before starting Compose or the native API, then configure a mock carrier account. The mock is never enabled in production mode and never calls a provider. Its inventory is read from local active numbers, so mock purchases and completed ports remain visible after an API restart.

Before the first sign-in, export `DATAPHONE_BOOTSTRAP_EMAIL` and `DATAPHONE_BOOTSTRAP_PASSWORD` in your shell. The password must be at least 12 characters. Then run `docker compose exec -e DATAPHONE_BOOTSTRAP_EMAIL -e DATAPHONE_BOOTSTRAP_PASSWORD api node apps/api/dist/auth/bootstrap-cli.js`. The command creates the first Super Admin only when the user collection is empty. It never prints the password. Remove the variables from your shell after use. No default administrator account is created.

## Native development

Use Node.js 24 and pnpm 12.4.2. Set `MONGO_URI` to a MongoDB URL with an explicit database name; an empty path is rejected. Set `CORS_ORIGIN` to the frontend origin and optionally `PORT` (default 3000). Copy `.env.example` for reference, but do not commit a real `.env` file. Build the shared package before starting API or web; `pnpm build` builds all workspaces in dependency order.

After `pnpm build`, run `pnpm --filter @dataphone/api db:init` to apply the versioned core collections and indexes to the database named in `MONGO_URI`. Run `pnpm --filter @dataphone/api db:seed` to create or update the four initial roles and their permissions. Both commands can be repeated safely. The API readiness endpoint also applies the core schema when it first connects. To initialize the first administrator in native development, export `DATAPHONE_BOOTSTRAP_EMAIL` and `DATAPHONE_BOOTSTRAP_PASSWORD`, then run `pnpm --filter @dataphone/api db:bootstrap-admin` once. Keep `JWT_SECRET` out of the repository and set it before starting the API in production mode.
