# System architecture

DataPhone is an internal DID inventory and inbound porting application. The target deployment is a React browser app, a NestJS API and worker, and a self-hosted MongoDB replica set. The browser calls only the API; all permission decisions happen in NestJS.

Application use cases coordinate domain rules, repository ports, and carrier capability ports. TypeORM Mongo repositories handle ordinary CRUD. A native MongoDB gateway handles multi-document transactions, atomic job claims, change streams, GridFS, indexes, and advanced aggregation. A mutation that needs multiple documents, such as state plus audit plus outbox, performs **every write through one native client and session**. TypeORM's MongoDB query runner has no transaction support, so its calls cannot be mixed into that session.

Carrier adapters normalize native statuses and errors. Only capabilities backed by provider contracts can be enabled. Persistent MongoDB jobs execute through bounded RxJS streams; change streams may wake workers and periodic scans recover missed work. SSE reads persisted job events and never executes a job.

The system uses E.164 numbers, idempotency keys, append-only audit events, correlation IDs, encrypted porting data, and permission guards. Provider actions that could charge money, release a number, or submit a port require separate operational authorization. A single-node replica set permits transactions and change streams but has no node failure tolerance.

Phase branches start from the latest verified `Prod`; after verification they are pushed, fast-forwarded into `Prod`, and pushed again before the next branch is created.
