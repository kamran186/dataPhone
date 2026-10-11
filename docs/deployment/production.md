# Production deployment guide

DataPhone is an internal proof of concept. Deploy it behind HTTPS with a private MongoDB replica set, restricted database credentials, a secret manager, and a backup schedule. The Compose file is for local development and is not the production topology.

## Required environment

Use [.env.production.example](../../.env.production.example) as a key list, not as a file to fill with secrets and commit. Set `NODE_ENV=production`, a named-database `MONGO_URI`, `CORS_ORIGIN` to the exact HTTPS web origin, and a stable `JWT_SECRET` of at least 32 bytes. Set `DATAPHONE_PORT_ENCRYPTION_KEY` to a base64-encoded random 32-byte value. Production startup rejects a missing or invalid port key. Store the key separately from database backups; both are needed to restore encrypted port documents and account fields. `DATAPHONE_ENABLE_MOCK_CARRIER` must remain `false`; mock mode is disabled in production even if set to `true`.

For read-only Bandwidth inventory, add credentials to the secret manager under the `DATAPHONE_CARRIER_<credentialRef>_USERNAME` and `_PASSWORD` names used by the configured carrier account. Do not put credentials in the database or repository. Peerless and BulkVS capabilities remain unavailable without account-specific contracts and test credentials. Live purchasing, disconnect, and port submission are not enabled.

## Deploy and verify

1. Install locked dependencies with `pnpm install --frozen-lockfile`, then run `pnpm build`.
2. Apply the schema and role seed with `pnpm --filter @dataphone/api db:init` and `pnpm --filter @dataphone/api db:seed` against the target replica set. Use a database user with only the privileges needed for DataPhone collections, indexes, and transactions.
3. Bootstrap the first administrator once using `DATAPHONE_BOOTSTRAP_EMAIL` and `DATAPHONE_BOOTSTRAP_PASSWORD` from your secret manager, then remove those bootstrap values from the runtime environment. Subsequent users are created in the protected UI/API.
4. Start the API with `pnpm --filter @dataphone/api start` behind an HTTPS reverse proxy. Serve the built `apps/web/dist` as a static site and proxy `/api` to the API. Keep MongoDB off public networks.
5. Check `/api/v1/health/live` and `/api/v1/health/ready`, sign in, inspect the carrier sync status, and verify protected routes reject anonymous requests. Monitor failed jobs and reconciliation issues.

The worker starts with the API unless `DATAPHONE_JOB_WORKER_DISABLED=true`; only disable it when a separate worker process is running. Use the same JWT and port encryption keys across instances. Back up the MongoDB database and encryption key before schema changes. Run the [restore procedure](backup-restore.md) regularly.

## Current validation limit

The native API, MongoDB integration suites, production builds, and Compose configuration have passed. Container smoke is pending because Docker Desktop on the development host is unavailable. Provider-specific live acceptance has not been run.
