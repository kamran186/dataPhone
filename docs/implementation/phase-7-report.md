# Phase 7 report: customers, assignments, and audit history

## Delivered

- Customer creation, search, detail, versioned updates, soft inactivation, and paginated current-number listings.
- Single and bulk assignment, transfer, and unassignment. Each ownership period has a start and end time. The partial unique index permits only one active customer per number.
- Native MongoDB transactions tie each customer or assignment mutation to an append-only number event. A global chain head gives events a unique sequence and links SHA-256 hashes across actor, related records, previous/new values, and timestamp.
- Protected customer, assignment, number-history, and customer-history endpoints. History supports event-type and inclusive date filters, pagination, and both sides of a transfer.
- Browser customer list, creation and editing, customer detail and number list, single and bulk assignment dialogs, transfer and unassignment confirmation, and filtered number/customer timelines.

## Verification

The isolated MongoDB suite covers customer changes, version conflicts, customer listings, single and bulk assignment, bulk rollback, transfers, unassignment, concurrent claims, protected endpoints, event modification detection, history filtering, and hash integrity. The full suite passed: API 64/64 and web 11/11. Typecheck, lint, format check, build, Compose configuration, and production dependency audit passed. The audit found no known vulnerabilities. The web build reported a non-failing 704 kB chunk-size warning.

## Design and limits

Customer removal is a versioned status change to `inactive`; historical records remain. Assignments are restricted to active numbers and active customers. A transfer preserves the prior ownership period. Bulk assignment accepts 1–100 distinct numbers and is all-or-nothing.

The hash chain catches accidental or unauthorized event changes if the chain head remains intact. Application services expose no audit update/delete operation, and the shared update helper rejects event changes. A database administrator with direct write access could rewrite events and the head together; production tamper evidence requires an independently retained checkpoint, backup controls, and role separation. The global chain head serializes ownership writes and may need partitioning if write volume grows. Live carrier acceptance and Docker container smoke remain pending the external access and host issues described in earlier reports.

## Task checklist

- [x] Implement customer CRUD through create, read, versioned update, and soft inactivation.
- [x] Implement customer number listing, single/bulk ownership, transfer, unassignment, and historical periods.
- [x] Enforce one active owner and transactional state/event writes with concurrency safeguards.
- [x] Record actor, prior/new state, and a verifiable append-only hash chain.
- [x] Implement protected number/customer timelines with history filters.
- [x] Implement customer management, assignment dialogs, and history views.
- [x] Verify rollback, concurrent ownership, history, and hash detection.
- [ ] Verify Docker container smoke when Docker Desktop is healthy.
