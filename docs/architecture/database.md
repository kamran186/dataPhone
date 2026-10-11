# Database design

MongoDB Community Edition is the primary store. TypeORM Mongo repositories handle ordinary entities; the native driver handles capabilities TypeORM does not expose. Both use one configured URI and database name. **The database name must appear in the URI path as well as TypeORM's `database` option**: the Phase 0 probe found that an empty URI path can make TypeORM use a default database.

A native transaction uses one `MongoClient` and one session for every write. A session cannot be passed to TypeORM's separate internal client. Repository interfaces must keep this distinction explicit. TypeORM remains the primary persistence abstraction for nontransactional CRUD.

Planned collections: `users`, `roles`, `customers`, `carriers`, `carrier_accounts`, `phone_numbers`, `number_holdings`, `number_assignments`, `number_events`, `purchase_orders`, `port_requests`, `port_request_numbers`, `background_jobs`, `job_events`, `carrier_sync_runs`, `reconciliation_issues`, `operation_outbox`, and `security_audit_events`. GridFS uses its files/chunks collections.

Phase 2 will define exact schemas and rerunnable indexes. Required invariants include unique `phone_numbers.e164`, one active assignment per number, carrier account/native number identity, job status and lease lookup, job idempotency, and event lookup by aggregate and time. Historical events are append-only through the application. Hash chains require independently retained checkpoints to detect tampering by a highly privileged database operator. Backups and restore drills are required before production use.
