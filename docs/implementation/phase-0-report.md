# Phase 0 report: architecture discovery and feasibility

## Findings

- The shared GitHub repository initially contained only a one-line README on `main`. No application, tests, configuration, secrets, or Peerless WSDL files were present.
- The host has Node.js 24.20.0, pnpm 12.4.2, MongoDB 7.0.31, and Docker CLI 29.6.1. The Docker daemon was stopped.
- Installed package metadata declares TypeORM 1.1.2 compatible with MongoDB driver 7.x and NestJS 12.1.2 compatible with RxJS 7.x; the lockfile records the dependency graph.
- An isolated local MongoDB single-node replica set was initialized. The test creates and removes a unique `dataphone_feasibility_*` database.
- TypeORM's MongoDB query runner has no transaction support. A transactional use case must use the native driver for every write inside its session.
- TypeORM and native MongoDB access the same database when its name is explicit in the URI. An empty URI database path caused a detected mismatch on the first probe; the test now guards the correct configuration.
- Public carrier documentation was reviewed in the [capability matrix](../carriers/capability-matrix.md). No credentials, account access, or Peerless WSDL were supplied.

## Verification

`DATAPHONE_TEST_MONGO_URL='mongodb://127.0.0.1:27186/?replicaSet=rs_dataphone_phase0' pnpm test:feasibility` passed 7/7 checks: configuration input, NestJS/RxJS resolution, TypeORM CRUD visible to the native client, transaction commit and rollback, change stream delivery, and GridFS byte round trip. `pnpm audit --prod` found no known vulnerabilities. The first probe failed on the URI database mismatch and passed after correction. Docker Compose validation was unavailable because the daemon was stopped. Lint, TypeScript compilation, and production build do not apply yet because Phase 0 contains no product TypeScript or app build.

## Risks and remaining validation

1. Carrier behavior is unverified without credentials and account permissions. Peerless SOAP work is blocked until DataPhone supplies WSDL files.
2. A single-node replica set has no replica redundancy.
3. Phase 2 must enforce the TypeORM/native transaction boundary described in the database design.
4. Docker deployment and restart recovery remain for later phases and require a running daemon.

References: [TypeORM MongoDB support](https://v0.typeorm.io/docs/drivers/mongodb/), [MongoDB transactions](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/), [MongoDB change streams](https://www.mongodb.com/docs/manual/changestreams/), and [MongoDB GridFS](https://www.mongodb.com/docs/drivers/node/current/crud/gridfs/).
