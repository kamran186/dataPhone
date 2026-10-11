# Phase 7 Customers, Assignments, and Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver customer management, transactional number ownership, and verifiable append-only history.

**Architecture:** Customers, assignment periods, and number events live in MongoDB. Each mutation writes business state and one or more audit events in a native transaction. A single chain-head document serializes event hashes; unique active-assignment indexing and transaction retries guard concurrent ownership changes. Read endpoints paginate and filter history; the browser exposes customers, assignments, and timelines.

**Tech Stack:** NestJS, MongoDB native transactions, TypeScript, React, MUI, TanStack Query, Jest, Vitest.

**Spec:** User-provided DATAPHONE master prompt, Phase 7, lines 1133–1198.

## Global Constraints

- Start from verified Phase 6 `Prod` and work on `phase-7-customers-assignments-audit`.
- Preserve one current customer per number and never rewrite or delete an audit event through application services.
- Keep customer mutation and audit recording in one MongoDB transaction.
- Require `customers.manage` for customer writes, `numbers.assign` for ownership writes, and `audit.view` for history.
- Keep live carrier and billable operations outside Phase 7.

## Review Focus

- Concurrent claims of one number: only one active assignment and one successful audit event.
- Invalid or missing customer/number IDs: reject without writing assignment or history.
- Bulk input with one invalid number: roll back the whole bulk request.
- Repeat assignment to the same customer: reject or return stable no-op without opening another period.
- History filtering with malformed dates or unsupported event types: return 400, not an unbounded query.

---

### Task 1: Customer records and API

**Files:** Create `apps/api/src/ownership/customers.service.ts`, `apps/api/src/ownership/customers.controller.ts`, `apps/api/src/ownership/ownership.http.ts`; modify `apps/api/src/app.module.ts`; test `apps/api/test/ownership.integration.spec.ts`.

**Interfaces:** `CustomersService.create(input, actorId)`, `update(id, input, actorId)`, `list(query)`, `get(id)`, `numbers(id, query)` return safe JSON. `AuditService.append` from Task 2 records customer changes.

- [x] Write customer CRUD, validation, missing ID, paging, and permissions tests; run the focused test and confirm failure.
- [x] Implement the service and protected routes, including a unique external ID and versioned updates; run the focused test and confirm pass.

### Task 2: Append-only hash chain and history

**Files:** Create `apps/api/src/ownership/audit.service.ts`, `apps/api/src/ownership/history.controller.ts`; modify `apps/api/src/database/schema.ts`; test `apps/api/test/ownership.integration.spec.ts`. The existing infrastructure helper already rejects audit updates.

**Interfaces:** `AuditService.append(db, session, event)` writes one event and advances `audit_chain_heads/global`; `verify()` rehashes the full chain; `numberHistory(id, filter)` and `customerHistory(id, filter)` return bounded results.

- [x] Write failing tests for actor, previous/new values, hash integrity, history filters, and append-only update rejection.
- [x] Implement SHA-256 chain over canonical event payload and previous hash; add unique sequence index and history query indexes; run tests.

### Task 3: Assignment periods and transactional mutations

**Files:** Create `apps/api/src/ownership/assignments.service.ts`, `apps/api/src/ownership/assignments.controller.ts`; modify `apps/api/src/app.module.ts`; test `apps/api/test/ownership.integration.spec.ts`.

**Interfaces:** `assign(numberId, customerId, actorId)`, `bulk(numberIds, customerId, actorId)`, `transfer(numberId, customerId, actorId)`, `unassign(numberId, actorId)` each commit period changes and audit events atomically. Bulk accepts at most 100 unique numbers.

- [x] Write failing tests for assign, bulk, transfer, unassign, historical periods, concurrent claims, and bulk rollback.
- [x] Implement input validation, transaction writes, conflict translation, and chain append; run focused tests.

### Task 4: Browser workflows and final verification

**Files:** Modify `apps/web/src/pages/customers-page.tsx`, `apps/web/src/pages/number-detail-page.tsx`, `apps/web/src/app/app.tsx`; create a customer detail page if needed; test `apps/web/src/app/app.test.tsx`.

**Interfaces:** Customer list/create/edit/detail, number assignment actions, and number/customer history use the protected endpoints above.

- [x] Write browser tests for customer management, assignment, transfer/unassign, and history; confirm failure.
- [x] Implement the pages and dialogs; run browser tests and full API suite.
- [x] Run typecheck, lint, format, build, dependency audit, frozen install, Compose config, and diff checks.
- [ ] Commit the requested phase message, record results, push the phase branch, fast-forward and verify `Prod`, then create Phase 8 from `Prod`.
