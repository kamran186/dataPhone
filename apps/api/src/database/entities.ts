import { ObjectId } from "mongodb";
import { EntitySchema, EntitySchemaColumnOptions } from "typeorm";

export interface BaseRecord {
  _id: ObjectId;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerRecord extends BaseRecord {
  name: string;
  externalId: string;
  status: string;
}

const baseColumns: Record<string, EntitySchemaColumnOptions> = {
  _id: { type: String, objectId: true, primary: true },
  version: { type: "int" },
  createdAt: { type: Date },
  updatedAt: { type: Date },
};

const dateFields = new Set([
  "availableAt",
  "detectedAt",
  "leaseUntil",
  "runAt",
  "startedAt",
]);

export const CustomerEntity = new EntitySchema<CustomerRecord>({
  name: "Customer",
  tableName: "customers",
  columns: {
    _id: { type: String, objectId: true, primary: true },
    name: { type: "string" },
    externalId: { type: "string" },
    status: { type: "string" },
    version: { type: "int" },
    createdAt: { type: Date },
    updatedAt: { type: Date },
  },
});

const definitions = [
  {
    name: "User",
    collection: "users",
    fields: [
      "email",
      "emailNormalized",
      "displayName",
      "passwordHash",
      "roleKeys",
      "active",
      "tokenVersion",
    ],
  },
  { name: "Role", collection: "roles", fields: ["key", "name"] },
  { name: "Carrier", collection: "carriers", fields: ["code", "displayName"] },
  {
    name: "CarrierAccount",
    collection: "carrier_accounts",
    fields: ["carrierId", "externalAccountId", "status"],
  },
  {
    name: "PhoneNumber",
    collection: "phone_numbers",
    fields: [
      "e164",
      "carrierId",
      "carrierAccountId",
      "carrierNumberId",
      "status",
    ],
  },
  {
    name: "NumberHolding",
    collection: "number_holdings",
    fields: ["phoneNumberId", "customerId", "status"],
  },
  {
    name: "NumberAssignment",
    collection: "number_assignments",
    fields: ["phoneNumberId", "customerId", "active"],
  },
  {
    name: "NumberEvent",
    collection: "number_events",
    fields: ["phoneNumberId", "type"],
  },
  {
    name: "PurchaseOrder",
    collection: "purchase_orders",
    fields: ["idempotencyKey", "status"],
  },
  {
    name: "PortRequest",
    collection: "port_requests",
    fields: ["externalReference", "status"],
  },
  {
    name: "PortRequestNumber",
    collection: "port_request_numbers",
    fields: ["portRequestId", "e164"],
  },
  {
    name: "BackgroundJob",
    collection: "background_jobs",
    fields: ["type", "status", "runAt", "leaseUntil", "idempotencyKey"],
  },
  { name: "JobEvent", collection: "job_events", fields: ["jobId", "type"] },
  {
    name: "CarrierSyncRun",
    collection: "carrier_sync_runs",
    fields: ["carrierAccountId", "status", "startedAt"],
  },
  {
    name: "ReconciliationIssue",
    collection: "reconciliation_issues",
    fields: ["status", "detectedAt"],
  },
  {
    name: "OperationOutbox",
    collection: "operation_outbox",
    fields: ["status", "availableAt", "idempotencyKey"],
  },
  {
    name: "SecurityAuditEvent",
    collection: "security_audit_events",
    fields: ["actorId", "action"],
  },
] as const;

export const coreEntityNames = [
  "Customer",
  ...definitions.map((definition) => definition.name),
] as const;

export const coreEntities = [
  CustomerEntity,
  ...definitions.map((definition) => {
    const columns: Record<string, EntitySchemaColumnOptions> = {
      ...baseColumns,
    };
    for (const field of definition.fields) {
      columns[field] = {
        type:
          field === "active"
            ? Boolean
            : field === "roleKeys"
              ? "simple-array"
              : field === "tokenVersion"
                ? Number
                : dateFields.has(field)
                  ? Date
                  : String,
      };
    }
    return new EntitySchema({
      name: definition.name,
      tableName: definition.collection,
      columns,
    });
  }),
];
