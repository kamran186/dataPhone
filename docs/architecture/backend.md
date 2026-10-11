# Backend architecture

The target is a NestJS modular monolith with strict TypeScript, REST, OpenAPI, class-validator, class-transformer, and RxJS. Each business module separates controllers/DTOs, application use cases and ports, domain rules, and infrastructure adapters. Controllers do not query MongoDB or call carriers.

The request boundary adds a correlation ID, validates input, authenticates staff, checks granular permissions, and returns consistent errors. Logs contain operation outcomes without credentials, PINs, document bytes, or full porting payloads. Carrier adapters implement capability-specific ports and are resolved by a registry; unsupported operations return explicit errors.

For a multi-document mutation, a use case receives one native MongoDB session and passes it to all state, audit, and outbox writes. TypeORM is the default for CRUD that does not need that transaction. Jobs have durable state, atomic claims, leases, heartbeats, retry policy, and persisted progress. The API worker scans queued and expired jobs each second, and each handler must be idempotent because crash recovery can execute it again. SSE reads persisted job events by a per-job sequence cursor and never executes a job.
