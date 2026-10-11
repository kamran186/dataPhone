# Phase 8 Number Search, Purchase, and Disconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide safe carrier search, idempotent purchase orders, confirmed ownership, and tracked disconnects.

**Architecture:** Search normalizes offers from enabled carrier accounts and includes carrier, location, and pricing fields. Purchase and disconnect requests are durable orders coupled to background jobs in one transaction; jobs call capability ports and record confirmed results before inventory or assignment changes. The running API has no billable carrier capability, so production calls remain disabled until explicit authorization and carrier contract work.

**Tech Stack:** NestJS, MongoDB transactions, carrier registry, leased jobs/SSE, React/MUI, Jest/Vitest.

**Spec:** User-provided DATAPHONE master prompt, Phase 8, lines 1203–1271.

## Global Constraints

- Start on `phase-8-number-purchase-disconnect` from verified Phase 7 `Prod`.
- Do not execute real billable purchases or disconnects without explicit authorization; use only the deterministic mock in tests.
- Preserve provider idempotency keys and do not assign a number until the carrier confirms it.
- Keep purchase/disconnect state, inventory, ownership, and audit writes transactional at confirmation boundaries.
- Require granular purchase/disconnect permissions and a literal E.164 confirmation for disconnect.

## Review Focus

- Duplicate requests with one idempotency key must return one order; conflicting payloads must return 409.
- Partial provider completion must assign only confirmed numbers and clearly report the rest.
- Provider timeout must leave order retryable without creating an inventory number or assignment.
- A confirmed number already owned by another account must become an issue, not change owner.
- Repeated completion or worker lease recovery must not duplicate holdings, assignment periods, or events.

---

### Task 1: Search contracts and offers

**Files:** Modify `apps/api/src/carriers/domain.ts`, `apps/api/src/carriers/registry.ts`, `apps/api/src/carriers/mock.ts`; create `apps/api/src/purchases/purchases.service.ts`; test `apps/api/test/purchases.integration.spec.ts`.

**Interfaces:** `PurchasesService.search({ areaCode?, city?, region?, pattern?, quantity?, carrier? })` returns normalized offers with account, carrier, E.164, native ID, and pricing.

- [x] Write and run failing tests for area code, city/state, pattern, carrier comparison, normalization, and provider timeout.
- [x] Extend typed search capability and use deterministic mock contracts; implement multi-carrier search with per-carrier errors; run focused tests.

### Task 2: Durable purchase orders

**Files:** Create `apps/api/src/purchases/purchase.types.ts`, `apps/api/src/purchases/purchase.jobs.ts`, `apps/api/src/purchases/purchases.controller.ts`; modify `apps/api/src/jobs/job.store.ts`, `apps/api/src/database/schema.ts`, `apps/api/src/app.module.ts`; test `apps/api/test/purchases.integration.spec.ts`.

**Interfaces:** `createPurchase(input, actorId)` writes one order/job; `processPurchase(orderId, context)` calls the provider with the same idempotency key, records status, and confirms each returned number through ownership/audit transaction helpers.

- [x] Write and run failing tests for initiation, idempotency, partial/failed completion, no early assignment, retries, and audit history.
- [x] Implement order persistence, job handler, confirmation, protected list/detail/create endpoints, and SSE job reference; run focused tests.

### Task 3: Tracked disconnect

**Files:** Create `apps/api/src/purchases/disconnect.service.ts`; modify purchase controller/jobs, inventory status and ownership transaction helper; test `apps/api/test/purchases.integration.spec.ts`.

**Interfaces:** `requestDisconnect(numberId, confirmE164, idempotencyKey, actorId)` creates one job; `processDisconnect(requestId, context)` changes inventory and closes assignment only on provider confirmation.

- [x] Write and run failing tests for authorization, literal confirmation, idempotency, pending/failed/complete outcomes, and audit.
- [x] Implement mock-backed workflow and trackable request status; run focused tests.

### Task 4: Browser and final gates

**Files:** Create `apps/web/src/pages/purchases-page.tsx`; modify `apps/web/src/pages/number-detail-page.tsx`, `apps/web/src/app/app.tsx`, `apps/web/src/app/layout/app-layout.tsx`; test `apps/web/src/app/app.test.tsx`.

**Interfaces:** Search and compare offers, choose customer, request multiple numbers, track orders/jobs, and confirm disconnect from number detail.

- [x] Write and run failing browser tests for search/comparison, purchase request/status, and disconnect confirmation.
- [x] Implement browser flows; run full API/browser suites, static gates, frozen install, audit, and Compose checks.
- [ ] Commit requested phase message, record results, push phase branch, fast-forward and verify `Prod`, then create Phase 9 from `Prod`.
