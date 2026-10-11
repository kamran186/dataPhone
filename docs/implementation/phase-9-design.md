# Phase 9 design: inbound porting and encrypted documents

Phase 9 runs on `phase-9-port-in-documents`, created from verified Phase 8 `Prod` (`340d1facab652f59f6842346d3662a93ced8ef9f`). It implements the user-provided Phase 9 specification while keeping real port submissions disabled.

## State and provider boundary

Port requests have application states `DRAFT`, `SUBMITTED`, `DATE_CONFIRMED`, `COMPLETED`, `REJECTED`, and `CANCELLED`. Detailed provider status, order ID, FOC date, and rejection reason are stored separately. FOC only moves the request to `DATE_CONFIRMED`; it does not create inventory or ownership. A provider `complete` result only completes the confirmed numbers. Partial completion remains `SUBMITTED` with a recorded unfulfilled count and a review issue.

The running registry has no live `port.submit` capability. Every submission, resubmission, and status lookup is restricted to the mock carrier. A later real carrier implementation requires explicit authorization and tested provider contracts. Draft creation, encrypted uploads, and local cancellation do not contact a carrier.

## Sensitive data

Account number, PIN, and document bytes use AES-256-GCM with independent nonces and authentication tags. The key is a separate 32-byte base64 environment value. Public API responses and audit events never contain secrets or plaintext documents. Uploaded encrypted bytes go to GridFS; a port-scoped metadata collection links file IDs to requests. Read and download endpoints require `ports.manage` and verify the port/document relationship. Uploads are size and MIME limited, and GridFS objects are removed if metadata creation fails.

## Delivery order

1. Write failing integration tests for portability, validation, encrypted storage, authorization, state transitions, FOC, rejection/correction, resubmission, cancellation, and confirmed ownership.
2. Implement port service, document service, protected endpoints, and background job handlers.
3. Add browser port wizard/list/detail, document views, and SSE status.
4. Run full gates, document limits, commit and push Phase 9, fast-forward `Prod`, verify remote hashes, and create Phase 10 from `Prod`.
