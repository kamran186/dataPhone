# Inbound ports and encrypted documents

Port requests use `DRAFT`, `SUBMITTED`, `DATE_CONFIRMED`, `COMPLETED`, `REJECTED`, and `CANCELLED`. Provider order IDs, detailed status, FOC dates, and rejection reasons are stored separately. A FOC date confirms timing; it does not create inventory or ownership. Completion adds only confirmed numbers. Partial completion remains open with an unfulfilled count and reconciliation issue.

Port submission, resubmission, and order tracking currently execute only against the development mock carrier. Draft creation, encrypted uploads, and local cancellation do not contact a provider. Live carrier read integrations expose inventory and available-number search.

Account numbers, PINs, and document contents use AES-256-GCM with independent nonces and authentication tags. The key is a separate 32-byte base64 environment value. API responses and audit events omit plaintext secrets. Encrypted files are stored as PostgreSQL `bytea`; port metadata references the file through a foreign key. Document bytes, metadata, and audit events commit in one transaction. Downloads require `ports.manage` and verify the port/document relationship. PDF, PNG, and JPEG uploads are limited to 5 MB and have their file signatures checked.

Persistent jobs recover submissions and tracking after a process restart. Job leases prevent stale workers from completing newer work. State transitions and their audit events share one SQL transaction.
