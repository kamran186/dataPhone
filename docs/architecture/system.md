# System architecture

DataPhone is an internal DID inventory and inbound porting application. A React browser calls a NestJS modular API and worker backed by PostgreSQL 17. The browser has no carrier or database credentials. NestJS enforces permissions.

Application services coordinate domain rules, typed PostgreSQL repositories, and carrier capability interfaces. PostgreSQL tables hold business state with foreign keys and uniqueness constraints. Parameterized SQL joins power reporting. One transaction client commits related state, audit, and job events together. UUID strings identify records throughout the API.

Carrier adapters normalize numbers and errors from Peerless SOAP, BulkVS REST, and Bandwidth v2 JSON. Live capabilities are inventory and available-number search. A provider advertises only implemented capabilities. The optional development mock also executes purchasing and ports.

Jobs persist claims, leases, progress, retry schedules, and ordered events. Workers scan every second and claim rows with `FOR UPDATE SKIP LOCKED`. Handlers are idempotent because a process crash can cause re-execution. SSE reads stored events and never executes a job. Port documents and sensitive account fields are encrypted before SQL persistence.

See [database design](database.md), [security](security.md), and [carrier integration](../carriers/integration-requirements.md) for contracts and operational limits.
