// Initial PostgreSQL schema; immutable after release.
export const coreSql = String.raw`
CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer DEFAULT 1,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  "demoSeed" text,
  "email" text,
  "emailNormalized" text,
  "displayName" text,
  "passwordHash" text,
  "roleKeys" text[],
  "active" boolean,
  "tokenVersion" integer
);

CREATE TABLE "roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer DEFAULT 1,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  "demoSeed" text,
  "key" text,
  "name" text,
  "permissions" text[]
);

CREATE TABLE "customers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer DEFAULT 1,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  "demoSeed" text,
  "name" text,
  "externalId" text,
  "status" text
);

CREATE TABLE "carriers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer DEFAULT 1,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  "demoSeed" text,
  "code" text,
  "displayName" text
);

CREATE TABLE "carrier_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer DEFAULT 1,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  "demoSeed" text,
  "carrierId" uuid,
  "externalAccountId" text,
  "credentialRef" text,
  "status" text,
  "syncLeaseUntil" timestamptz,
  "syncLeaseToken" text,
  "lastSyncedAt" timestamptz
);

CREATE TABLE "phone_numbers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer DEFAULT 1,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  "demoSeed" text,
  "e164" text NOT NULL CHECK ("e164" ~ '^\+[1-9][0-9]{1,14}$'),
  "carrierId" uuid,
  "carrierAccountId" uuid,
  "carrierNumberId" text,
  "status" text,
  "firstSeenAt" timestamptz,
  "lastSeenAt" timestamptz
);

CREATE TABLE "number_holdings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer DEFAULT 1,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  "demoSeed" text,
  "phoneNumberId" uuid,
  "carrierAccountId" uuid,
  "customerId" uuid,
  "status" text,
  "startedAt" timestamptz,
  "endedAt" timestamptz
);

CREATE TABLE "number_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer DEFAULT 1,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  "demoSeed" text,
  "phoneNumberId" uuid,
  "customerId" uuid,
  "active" boolean,
  "startedAt" timestamptz,
  "endedAt" timestamptz
);

CREATE TABLE "number_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer DEFAULT 1,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  "demoSeed" text,
  "type" text,
  "actorId" uuid,
  "customerId" uuid,
  "relatedCustomerIds" uuid[],
  "phoneNumberId" uuid,
  "previous" jsonb,
  "next" jsonb,
  "sequence" bigint,
  "previousHash" text,
  "hash" text
);

CREATE TABLE "purchase_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer DEFAULT 1,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  "demoSeed" text,
  "idempotencyKey" text,
  "requestHash" text,
  "actorId" uuid,
  "customerId" uuid,
  "carrierAccountId" uuid,
  "nativeIds" text[],
  "jobId" uuid,
  "status" text,
  "nativeOrderId" text,
  "trackAttempt" integer,
  "items" jsonb,
  "unfulfilledCount" integer,
  "errorCode" text
);

CREATE TABLE "disconnect_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer DEFAULT 1,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  "demoSeed" text,
  "idempotencyKey" text,
  "requestHash" text,
  "phoneNumberId" uuid,
  "e164" text,
  "carrierAccountId" uuid,
  "actorId" uuid,
  "jobId" uuid,
  "status" text,
  "nativeOrderId" text,
  "trackAttempt" integer,
  "errorCode" text
);

CREATE TABLE "port_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer DEFAULT 1,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  "demoSeed" text,
  "actorId" uuid,
  "customerId" uuid,
  "carrierAccountId" uuid,
  "numbers" text[],
  "currentProvider" text,
  "accountName" text,
  "accountNumberEncrypted" bytea,
  "pinEncrypted" bytea,
  "serviceAddress" jsonb,
  "status" text,
  "nativeOrderId" text,
  "nativeStatus" text,
  "focDate" timestamptz,
  "rejectionReason" text,
  "jobId" uuid,
  "unfulfilledCount" integer,
  "externalReference" text
);

CREATE TABLE "port_request_numbers" (
  "completedAt" timestamptz,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer DEFAULT 1,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  "demoSeed" text,
  "portRequestId" uuid,
  "e164" text,
  "status" text
);

CREATE TABLE "port_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer DEFAULT 1,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  "demoSeed" text,
  "portRequestId" uuid,
  "fileId" uuid,
  "filename" text,
  "contentType" text,
  "byteLength" integer
);

CREATE TABLE "port_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer DEFAULT 1,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  "demoSeed" text,
  "portRequestId" uuid,
  "type" text,
  "actorId" uuid,
  "previous" jsonb,
  "next" jsonb
);

CREATE TABLE "background_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer DEFAULT 1,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  "demoSeed" text,
  "type" text,
  "payload" jsonb,
  "fingerprint" text,
  "idempotencyKey" text,
  "status" text,
  "attempts" integer,
  "maxAttempts" integer,
  "runAt" timestamptz,
  "leaseUntil" timestamptz,
  "leaseToken" text,
  "leaseOwner" text,
  "progress" integer,
  "eventSequence" integer,
  "result" jsonb,
  "failure" jsonb,
  "finishedAt" timestamptz
);

CREATE TABLE "job_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer DEFAULT 1,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  "demoSeed" text,
  "jobId" uuid,
  "sequence" integer,
  "type" text,
  "message" text,
  "progress" integer
);

CREATE TABLE "carrier_sync_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer DEFAULT 1,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  "demoSeed" text,
  "carrierAccountId" uuid,
  "status" text,
  "startedAt" timestamptz,
  "finishedAt" timestamptz,
  "seen" integer,
  "created" integer,
  "updated" integer,
  "missing" integer,
  "issues" integer,
  "errorCode" text
);

CREATE TABLE "reconciliation_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer DEFAULT 1,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  "demoSeed" text,
  "carrierAccountId" uuid,
  "phoneNumberId" uuid,
  "e164" text,
  "type" text,
  "status" text,
  "detectedAt" timestamptz,
  "resolvedAt" timestamptz
);

CREATE TABLE "operation_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer DEFAULT 1,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  "demoSeed" text,
  "type" text,
  "payload" jsonb,
  "status" text,
  "availableAt" timestamptz,
  "idempotencyKey" text,
  "attempts" integer,
  "jobId" uuid
);

CREATE TABLE "security_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer DEFAULT 1,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  "demoSeed" text,
  "actorId" uuid,
  "action" text,
  "type" text,
  "previous" jsonb,
  "next" jsonb
);

CREATE TABLE "auth_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer DEFAULT 1,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  "demoSeed" text,
  "userId" uuid,
  "tokenHash" text,
  "expiresAt" timestamptz,
  "revokedAt" timestamptz
);

CREATE TABLE "login_attempts" (
  "id" text PRIMARY KEY,
  "count" integer,
  "expiresAt" timestamptz
);

CREATE TABLE "auth_admin_guard" (
  "id" text PRIMARY KEY,
  "revision" integer
);

CREATE TABLE "audit_chain_heads" (
  "id" text PRIMARY KEY,
  "sequence" bigint,
  "hash" text
);

CREATE TABLE "document_bytes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "filename" text,
  "content" bytea
);

ALTER TABLE "carrier_accounts" ADD CONSTRAINT "fk_carrier_accounts_carrierId" FOREIGN KEY ("carrierId") REFERENCES "carriers" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "phone_numbers" ADD CONSTRAINT "fk_phone_numbers_carrierId" FOREIGN KEY ("carrierId") REFERENCES "carriers" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "phone_numbers" ADD CONSTRAINT "fk_phone_numbers_carrierAccountId" FOREIGN KEY ("carrierAccountId") REFERENCES "carrier_accounts" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "number_holdings" ADD CONSTRAINT "fk_number_holdings_phoneNumberId" FOREIGN KEY ("phoneNumberId") REFERENCES "phone_numbers" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "number_holdings" ADD CONSTRAINT "fk_number_holdings_carrierAccountId" FOREIGN KEY ("carrierAccountId") REFERENCES "carrier_accounts" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "number_holdings" ADD CONSTRAINT "fk_number_holdings_customerId" FOREIGN KEY ("customerId") REFERENCES "customers" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "number_assignments" ADD CONSTRAINT "fk_number_assignments_phoneNumberId" FOREIGN KEY ("phoneNumberId") REFERENCES "phone_numbers" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "number_assignments" ADD CONSTRAINT "fk_number_assignments_customerId" FOREIGN KEY ("customerId") REFERENCES "customers" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "number_events" ADD CONSTRAINT "fk_number_events_customerId" FOREIGN KEY ("customerId") REFERENCES "customers" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "number_events" ADD CONSTRAINT "fk_number_events_phoneNumberId" FOREIGN KEY ("phoneNumberId") REFERENCES "phone_numbers" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_purchase_orders_customerId" FOREIGN KEY ("customerId") REFERENCES "customers" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_purchase_orders_carrierAccountId" FOREIGN KEY ("carrierAccountId") REFERENCES "carrier_accounts" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_purchase_orders_jobId" FOREIGN KEY ("jobId") REFERENCES "background_jobs" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "disconnect_requests" ADD CONSTRAINT "fk_disconnect_requests_phoneNumberId" FOREIGN KEY ("phoneNumberId") REFERENCES "phone_numbers" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "disconnect_requests" ADD CONSTRAINT "fk_disconnect_requests_carrierAccountId" FOREIGN KEY ("carrierAccountId") REFERENCES "carrier_accounts" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "disconnect_requests" ADD CONSTRAINT "fk_disconnect_requests_jobId" FOREIGN KEY ("jobId") REFERENCES "background_jobs" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "port_requests" ADD CONSTRAINT "fk_port_requests_customerId" FOREIGN KEY ("customerId") REFERENCES "customers" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "port_requests" ADD CONSTRAINT "fk_port_requests_carrierAccountId" FOREIGN KEY ("carrierAccountId") REFERENCES "carrier_accounts" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "port_requests" ADD CONSTRAINT "fk_port_requests_jobId" FOREIGN KEY ("jobId") REFERENCES "background_jobs" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "port_request_numbers" ADD CONSTRAINT "fk_port_request_numbers_portRequestId" FOREIGN KEY ("portRequestId") REFERENCES "port_requests" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "port_documents" ADD CONSTRAINT "fk_port_documents_portRequestId" FOREIGN KEY ("portRequestId") REFERENCES "port_requests" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "port_documents" ADD CONSTRAINT "fk_port_documents_fileId" FOREIGN KEY ("fileId") REFERENCES "document_bytes" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "port_events" ADD CONSTRAINT "fk_port_events_portRequestId" FOREIGN KEY ("portRequestId") REFERENCES "port_requests" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "job_events" ADD CONSTRAINT "fk_job_events_jobId" FOREIGN KEY ("jobId") REFERENCES "background_jobs" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "carrier_sync_runs" ADD CONSTRAINT "fk_carrier_sync_runs_carrierAccountId" FOREIGN KEY ("carrierAccountId") REFERENCES "carrier_accounts" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "reconciliation_issues" ADD CONSTRAINT "fk_reconciliation_issues_carrierAccountId" FOREIGN KEY ("carrierAccountId") REFERENCES "carrier_accounts" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "reconciliation_issues" ADD CONSTRAINT "fk_reconciliation_issues_phoneNumberId" FOREIGN KEY ("phoneNumberId") REFERENCES "phone_numbers" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "operation_outbox" ADD CONSTRAINT "fk_operation_outbox_jobId" FOREIGN KEY ("jobId") REFERENCES "background_jobs" (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "auth_sessions" ADD CONSTRAINT "fk_auth_sessions_userId" FOREIGN KEY ("userId") REFERENCES "users" (id) DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX "uq_users_email_normalized" ON "users" ("emailNormalized");

CREATE UNIQUE INDEX "uq_roles_key" ON "roles" (key);

CREATE UNIQUE INDEX "uq_customers_external_id" ON "customers" ("externalId");

CREATE UNIQUE INDEX "uq_carriers_code" ON "carriers" (code);

CREATE UNIQUE INDEX "uq_carrier_accounts_identity" ON "carrier_accounts" ("carrierId", "externalAccountId");

CREATE UNIQUE INDEX "uq_phone_numbers_e164" ON "phone_numbers" (e164);

CREATE UNIQUE INDEX "uq_phone_numbers_native_identity" ON "phone_numbers" ("carrierAccountId", "carrierNumberId");

CREATE INDEX "ix_phone_numbers_status_carrier" ON "phone_numbers" (status, "carrierId");

CREATE UNIQUE INDEX "uq_assignments_active_number" ON "number_assignments" ("phoneNumberId") WHERE active;

CREATE INDEX "ix_assignments_customer" ON "number_assignments" ("customerId", active);

CREATE INDEX "ix_holdings_number" ON "number_holdings" ("phoneNumberId", status);

CREATE INDEX "ix_number_events_history" ON "number_events" ("phoneNumberId", "createdAt" DESC);

CREATE INDEX "ix_number_events_customer" ON "number_events" ("customerId", "createdAt" DESC);

CREATE UNIQUE INDEX "uq_number_events_sequence" ON "number_events" (sequence);

CREATE UNIQUE INDEX "uq_purchase_orders_idempotency" ON "purchase_orders" ("idempotencyKey");

CREATE UNIQUE INDEX "uq_disconnect_idempotency" ON "disconnect_requests" ("idempotencyKey");

CREATE UNIQUE INDEX "uq_disconnect_open_number" ON "disconnect_requests" ("phoneNumberId") WHERE status IN ('queued','running','retrying','pending');

CREATE UNIQUE INDEX "uq_port_requests_reference" ON "port_requests" ("externalReference");

CREATE UNIQUE INDEX "uq_port_request_numbers_identity" ON "port_request_numbers" ("portRequestId", e164);

CREATE UNIQUE INDEX "uq_open_port_number" ON "port_request_numbers" (e164) WHERE status IN ('DRAFT','SUBMITTED','DATE_CONFIRMED','REJECTED');

CREATE INDEX "ix_jobs_claim" ON "background_jobs" (status, "runAt", "leaseUntil");

CREATE UNIQUE INDEX "uq_jobs_idempotency" ON "background_jobs" ("idempotencyKey");

CREATE UNIQUE INDEX "uq_job_events_sequence" ON "job_events" ("jobId", sequence);

CREATE INDEX "ix_sync_runs_account" ON "carrier_sync_runs" ("carrierAccountId", "startedAt" DESC);

CREATE UNIQUE INDEX "uq_reconciliation_open_identity" ON "reconciliation_issues" ("carrierAccountId", e164, type) WHERE status = 'open';

CREATE UNIQUE INDEX "uq_outbox_idempotency" ON "operation_outbox" ("idempotencyKey");

CREATE INDEX "ix_auth_sessions_expiry" ON "auth_sessions" ("expiresAt");

CREATE INDEX "ix_login_attempts_expiry" ON "login_attempts" ("expiresAt");

INSERT INTO audit_chain_heads (id, sequence, hash) VALUES ('global', 0, repeat('0',64));

INSERT INTO auth_admin_guard (id, revision) VALUES ('last-admin',0);
`;
