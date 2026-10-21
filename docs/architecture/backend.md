# Backend architecture

NestJS modules expose REST/OpenAPI with validated DTOs and strict TypeScript. Controllers enforce input and permission boundaries; application services coordinate business rules and persistence. Carrier adapters are resolved through typed capability interfaces.

The PostgreSQL layer uses `pg`, parameterized queries, and an allowlisted typed table repository. Columns use SQL types; JSONB is reserved for variable event and job payloads. SQL migrations create relational constraints and indexes. Transaction callbacks share one client through explicit arguments and asynchronous context. Serializable retries apply only to database work, never carrier calls.

Jobs use atomic SQL row claims, leases, heartbeats, idempotency keys, and persisted events. A worker scans queued or expired work every second. SSE replays stored progress after a cursor. Authentication sessions and login-rate windows use expiry predicates plus periodic cleanup. Reports use SQL joins and aggregation.
