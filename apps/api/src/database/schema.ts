import { Db, IndexDescription } from "mongodb";

export const CORE_SCHEMA_VERSION = 1;

const coreCollections = [
  "users",
  "roles",
  "customers",
  "carriers",
  "carrier_accounts",
  "phone_numbers",
  "number_holdings",
  "number_assignments",
  "number_events",
  "purchase_orders",
  "disconnect_requests",
  "port_requests",
  "port_request_numbers",
  "background_jobs",
  "job_events",
  "carrier_sync_runs",
  "reconciliation_issues",
  "operation_outbox",
  "security_audit_events",
] as const;

const authCollections = ["auth_sessions", "login_attempts"] as const;

const indexes: Record<string, IndexDescription[]> = {
  users: [
    {
      name: "uq_users_email_normalized",
      key: { emailNormalized: 1 },
      unique: true,
      partialFilterExpression: { emailNormalized: { $exists: true } },
    },
    { name: "ix_users_active", key: { active: 1 } },
  ],
  roles: [{ name: "uq_roles_key", key: { key: 1 }, unique: true }],
  customers: [
    {
      name: "uq_customers_external_id",
      key: { externalId: 1 },
      unique: true,
      partialFilterExpression: { externalId: { $exists: true } },
    },
    { name: "ix_customers_name", key: { name: 1 } },
  ],
  carriers: [{ name: "uq_carriers_code", key: { code: 1 }, unique: true }],
  carrier_accounts: [
    {
      name: "uq_carrier_accounts_identity",
      key: { carrierId: 1, externalAccountId: 1 },
      unique: true,
    },
  ],
  phone_numbers: [
    { name: "uq_phone_numbers_e164", key: { e164: 1 }, unique: true },
    {
      name: "uq_phone_numbers_native_identity",
      key: { carrierAccountId: 1, carrierNumberId: 1 },
      unique: true,
      partialFilterExpression: { carrierNumberId: { $exists: true } },
    },
    {
      name: "ix_phone_numbers_status_carrier",
      key: { status: 1, carrierId: 1 },
    },
  ],
  number_holdings: [
    { name: "ix_holdings_customer_status", key: { customerId: 1, status: 1 } },
    { name: "ix_holdings_number", key: { phoneNumberId: 1 } },
  ],
  number_assignments: [
    {
      name: "uq_assignments_active_number",
      key: { phoneNumberId: 1 },
      unique: true,
      partialFilterExpression: { active: true },
    },
    { name: "ix_assignments_customer", key: { customerId: 1, active: 1 } },
  ],
  number_events: [
    {
      name: "ix_number_events_history",
      key: { phoneNumberId: 1, createdAt: -1 },
    },
    {
      name: "ix_number_events_customer",
      key: { customerId: 1, createdAt: -1 },
    },
    {
      name: "ix_number_events_related_customer",
      key: { relatedCustomerIds: 1, createdAt: -1 },
    },
    {
      name: "uq_number_events_sequence",
      key: { sequence: 1 },
      unique: true,
      partialFilterExpression: { sequence: { $exists: true } },
    },
  ],
  purchase_orders: [
    {
      name: "uq_purchase_orders_idempotency",
      key: { idempotencyKey: 1 },
      unique: true,
    },
    { name: "ix_purchase_orders_status", key: { status: 1, createdAt: -1 } },
  ],
  disconnect_requests: [
    {
      name: "uq_disconnect_idempotency",
      key: { idempotencyKey: 1 },
      unique: true,
    },
    {
      name: "uq_disconnect_open_number",
      key: { phoneNumberId: 1 },
      unique: true,
      partialFilterExpression: {
        status: { $in: ["queued", "running", "retrying", "pending"] },
      },
    },
    {
      name: "ix_disconnect_number_status",
      key: { phoneNumberId: 1, status: 1 },
    },
  ],
  port_requests: [
    {
      name: "uq_port_requests_reference",
      key: { externalReference: 1 },
      unique: true,
      partialFilterExpression: { externalReference: { $exists: true } },
    },
    { name: "ix_port_requests_status", key: { status: 1, updatedAt: -1 } },
  ],
  port_request_numbers: [
    {
      name: "uq_port_request_numbers_identity",
      key: { portRequestId: 1, e164: 1 },
      unique: true,
    },
  ],
  background_jobs: [
    { name: "ix_jobs_claim", key: { status: 1, runAt: 1, leaseUntil: 1 } },
    {
      name: "uq_jobs_idempotency",
      key: { idempotencyKey: 1 },
      unique: true,
      partialFilterExpression: { idempotencyKey: { $exists: true } },
    },
  ],
  job_events: [
    { name: "ix_job_events_history", key: { jobId: 1, createdAt: 1 } },
  ],
  carrier_sync_runs: [
    {
      name: "ix_sync_runs_account",
      key: { carrierAccountId: 1, startedAt: -1 },
    },
  ],
  reconciliation_issues: [
    { name: "ix_reconciliation_status", key: { status: 1, detectedAt: -1 } },
    {
      name: "uq_reconciliation_open_identity",
      key: { carrierAccountId: 1, e164: 1, type: 1 },
      unique: true,
      partialFilterExpression: { status: "open" },
    },
  ],
  operation_outbox: [
    { name: "ix_outbox_dispatch", key: { status: 1, availableAt: 1 } },
    {
      name: "uq_outbox_idempotency",
      key: { idempotencyKey: 1 },
      unique: true,
      partialFilterExpression: { idempotencyKey: { $exists: true } },
    },
  ],
  security_audit_events: [
    { name: "ix_security_audit_time", key: { createdAt: -1 } },
    { name: "ix_security_audit_actor", key: { actorId: 1, createdAt: -1 } },
  ],
  auth_sessions: [
    { name: "ix_auth_sessions_user", key: { userId: 1, expiresAt: 1 } },
    { name: "ttl_auth_sessions", key: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ],
  login_attempts: [
    {
      name: "ttl_login_attempts",
      key: { expiresAt: 1 },
      expireAfterSeconds: 0,
    },
  ],
};

export async function initializeCoreSchema(db: Db): Promise<void> {
  for (const name of coreCollections) {
    await db.collection(name).createIndexes(indexes[name]);
  }
  await db
    .collection("audit_chain_heads")
    .updateOne(
      { _id: "global" as never },
      { $setOnInsert: { sequence: 0, hash: "0".repeat(64) } },
      { upsert: true },
    );
  await db.collection("schema_migrations").updateOne(
    { _id: "core-v1" as never },
    {
      $setOnInsert: {
        version: CORE_SCHEMA_VERSION,
        appliedAt: new Date(),
        collections: [...coreCollections],
      },
    },
    { upsert: true },
  );
  await initializeAuthSchema(db);
  await initializeJobsSchema(db);
}

async function initializeJobsSchema(db: Db): Promise<void> {
  await db
    .collection("job_events")
    .createIndex(
      { jobId: 1, sequence: 1 },
      { name: "uq_job_events_sequence", unique: true },
    );
  await db.collection("schema_migrations").updateOne(
    { _id: "jobs-v1" as never },
    {
      $setOnInsert: {
        version: 1,
        appliedAt: new Date(),
        collections: ["background_jobs", "job_events"],
      },
    },
    { upsert: true },
  );
}

async function initializeAuthSchema(db: Db): Promise<void> {
  for (const name of authCollections) {
    await db.collection(name).createIndexes(indexes[name]);
  }
  await db
    .collection("auth_admin_guard")
    .updateOne(
      { _id: "last-admin" as never },
      { $setOnInsert: { revision: 0 } },
      { upsert: true },
    );
  await db.collection("schema_migrations").updateOne(
    { _id: "auth-v1" as never },
    {
      $setOnInsert: {
        version: 1,
        appliedAt: new Date(),
        collections: [...authCollections, "auth_admin_guard"],
      },
    },
    { upsert: true },
  );
}
