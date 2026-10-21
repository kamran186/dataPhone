# PostgreSQL persistence

PostgreSQL 17 is the primary database. The API uses `pg` through a typed table repository. Each domain field is a real typed SQL column; core relationships have foreign keys, E.164 values have a check constraint, and partial unique indexes enforce one active assignment, open port, or disconnect per number. Variable event values, job payloads, and carrier results use JSONB. IDs are UUIDs represented as strings in REST responses.

`DatabaseInfrastructure.withTransaction()` uses one checked-out client for state, audit, and job writes. An asynchronous transaction context prevents helper calls from escaping that client. Serializable transactions retry serialization failures and deadlocks up to five times. Callbacks must contain only database work; carrier requests happen before the transaction and must never be retried as part of it.

`database/migrations/001-core.ts` contains the initial SQL migration. The runner records versions in `schema_migrations` and takes a transaction advisory lock so concurrent API instances cannot apply a migration twice. Published migrations are immutable; append a new numbered migration for subsequent changes. Initialization and seeds are rerunnable. The application checks readiness after schema initialization.

Jobs are claimed in one SQL statement with `FOR UPDATE SKIP LOCKED`. Lease tokens reject stale worker writes. Event sequence and idempotency indexes preserve restart recovery and SSE replay. Expired authentication records are ignored by queries and removed periodically.

Port account fields and document contents retain the existing application encryption. Encrypted document bytes use `bytea` in `document_bytes`; file metadata and audit writes commit in the same transaction. Uploads remain limited to 5 MB before encryption.

Audit events keep a global sequence and SHA-256 chain. JSON values are canonicalized before hashing because JSONB does not preserve object key order. The chain head and event commit with the business change. Application routes cannot edit history; database owners remain privileged, so independently retained checkpoints are still needed to detect privileged tampering.

Fresh PostgreSQL seeds create roles, carrier definitions, the bootstrap administrator, and optional development demo records. See this document and the deployment notes for the persistence contract.
