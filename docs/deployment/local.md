# Local deployment

## Compose

Run `docker compose up --build -d` from the repository root, then open `http://localhost:8080`. The web port is bound to `127.0.0.1`; MongoDB and API stay on the private Compose network. `mongo-init` initializes a single-node replica set named `rs0` and exits. MongoDB data persists in the `mongo_data` volume.

Use `docker compose ps` to check service health. `GET http://localhost:8080/api/v1/health/live` checks the API process; `/api/v1/health/ready` checks MongoDB connectivity. `docker compose down` stops the stack while preserving the volume. `docker compose down -v` deletes the local MongoDB volume and should only be used when its data is disposable.

The current Phase 1 build has no staff authentication, carrier accounts, or production secrets. It is for local validation only. Later phases add user access control, encrypted sensitive data, backup and restore guidance, and deployment hardening. A single-node replica set has no node failure tolerance.

## Native development

Use Node.js 24 and pnpm 12.4.2. Set `MONGO_URI` to a MongoDB URL with an explicit database name; an empty path is rejected. Set `CORS_ORIGIN` to the frontend origin and optionally `PORT` (default 3000). Copy `.env.example` for reference, but do not commit a real `.env` file. Build the shared package before starting API or web; `pnpm build` builds all workspaces in dependency order.

After `pnpm build`, run `pnpm --filter @dataphone/api db:init` to apply the versioned core collections and indexes to the database named in `MONGO_URI`. Run `pnpm --filter @dataphone/api db:seed` to create the four initial role names. Both commands can be repeated safely. The API readiness endpoint also applies the core schema when it first connects. Role permissions and administrator bootstrap arrive in Phase 3.
