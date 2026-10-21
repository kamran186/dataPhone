import { createHash } from "node:crypto";
import { Row, SqlSession, uuid } from "./query";
import {
  hashPassword,
  validatePassword,
  verifyPassword,
} from "../auth/password";
import { appendAuditEvent } from "../ownership/audit.service";
import { PortCrypto } from "../ports/port.crypto";
import { DatabaseInfrastructure } from "./database.infrastructure";
import { seedCoreRoles } from "./seed";

const DEMO = "dataphone-demo-v1";
const date = (day: number) => new Date(Date.UTC(2026, 9, day, 14));
const id = (name: string) => {
  const hex = createHash("sha256").update(`${DEMO}:${name}`).digest("hex");
  return uuid(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
  );
};

const users = [
  { email: "admin@email.com", role: "SUPER_ADMIN", name: "Demo Administrator" },
  {
    email: "operationsmanager@email.com",
    role: "OPERATIONS_MANAGER",
    name: "Demo Operations Manager",
  },
  {
    email: "operationsstaff@email.com",
    role: "OPERATIONS_STAFF",
    name: "Demo Operations Staff",
  },
  { email: "viewer@email.com", role: "VIEWER", name: "Demo Viewer" },
] as const;

export async function seedDemoData(
  database: DatabaseInfrastructure,
  password: string,
): Promise<void> {
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo seeding is disabled in production");
  if (process.env.DATAPHONE_ENABLE_MOCK_CARRIER !== "true")
    throw new Error("Demo seeding requires DATAPHONE_ENABLE_MOCK_CARRIER=true");
  validatePassword(password);
  const crypto = new PortCrypto();
  await seedCoreRoles(database);
  const db = database.sql();
  const carrier = await db.table("carriers").findOne({ code: "mock" });
  if (!carrier) throw new Error("Local mock carrier is unavailable");

  // Existing records with these identities are never adopted or overwritten.
  for (const user of users) {
    const existing = await db
      .table("users")
      .findOne({ emailNormalized: user.email });
    if (existing && existing.demoSeed !== DEMO)
      throw new Error(
        `Demo email already belongs to another account: ${user.email}`,
      );
    if (
      existing &&
      !(await verifyPassword(password, existing.passwordHash as string))
    )
      throw new Error(`Demo account has a different password: ${user.email}`);
  }
  for (const externalId of ["DEMO-ACME", "DEMO-NORTHSTAR", "DEMO-HARBOR"]) {
    const existing = await db.table("customers").findOne({ externalId });
    if (existing && existing.demoSeed !== DEMO)
      throw new Error(`Demo customer ID is already in use: ${externalId}`);
  }
  const numbers = Array.from(
    { length: 16 },
    (_, index) => `+120255501${String(index).padStart(2, "0")}`,
  );
  for (const e164 of numbers) {
    const existing = await db.table("phone_numbers").findOne({ e164 });
    if (existing && existing.demoSeed !== DEMO)
      throw new Error(`Demo number is already in use: ${e164}`);
  }

  const hashes = await Promise.all(users.map(() => hashPassword(password)));
  const adminId = id("user-admin");
  const accountId = id("mock-account");
  const customerIds = [
    id("customer-acme"),
    id("customer-northstar"),
    id("customer-harbor"),
  ];
  const numberIds = numbers.map((_, index) => id(`number-${index}`));
  const jobIds = [id("job-purchase"), id("job-sync"), id("job-disconnect")];
  const portIds = [
    id("port-draft"),
    id("port-submitted"),
    id("port-completed"),
    id("port-rejected"),
  ];
  const at = date(10);
  const base = { demoSeed: DEMO, version: 1, createdAt: at, updatedAt: at };
  const upsert = async (
    collection: string,
    key: string,
    record: Row,
    session: SqlSession,
  ) => {
    const recordId = id(key);
    const existing = await db
      .table(collection)
      .findOne({ id: recordId }, { session });
    if (existing && existing.demoSeed !== DEMO)
      throw new Error(`Demo ID collision in ${collection}: ${key}`);
    await db
      .table(collection)
      .updateOne(
        { id: recordId },
        { $setOnInsert: { id: recordId, ...record, demoSeed: DEMO } },
        { upsert: true, session },
      );
  };

  await database.withTransaction(async (_tx, session) => {
    for (let index = 0; index < users.length; index += 1) {
      const user = users[index];
      await upsert(
        "users",
        `user-${index === 0 ? "admin" : user.role.toLowerCase()}`,
        {
          ...base,
          email: user.email,
          emailNormalized: user.email,
          displayName: user.name,
          passwordHash: hashes[index],
          roleKeys: [user.role],
          active: true,
          tokenVersion: 1,
        },
        session,
      );
    }
    for (const [index, [name, externalId]] of [
      ["Acme Services", "DEMO-ACME"],
      ["Northstar Health", "DEMO-NORTHSTAR"],
      ["Harbor Logistics", "DEMO-HARBOR"],
    ].entries()) {
      await upsert(
        "customers",
        ["customer-acme", "customer-northstar", "customer-harbor"][index],
        {
          ...base,
          name,
          externalId,
          status: "active",
        },
        session,
      );
    }
    await upsert(
      "carrier_accounts",
      "mock-account",
      {
        ...base,
        carrierId: carrier.id,
        externalAccountId: "demo-mock-account",
        status: "active",
        lastSyncedAt: date(11),
      },
      session,
    );
    for (let index = 0; index < numbers.length; index += 1) {
      await upsert(
        "phone_numbers",
        `number-${index}`,
        {
          ...base,
          e164: numbers[index],
          carrierId: carrier.id,
          carrierAccountId: accountId,
          carrierNumberId: `demo-native-${index}`,
          status:
            index === 14 ? "missing" : index === 15 ? "disconnected" : "active",
          firstSeenAt: date(8),
          lastSeenAt: date(11),
        },
        session,
      );
      await upsert(
        "number_holdings",
        `holding-${index}`,
        {
          phoneNumberId: numberIds[index],
          carrierAccountId: accountId,
          status: index === 15 ? "closed" : "active",
          startedAt: date(8),
          ...(index === 15 ? { endedAt: date(11) } : {}),
          createdAt: date(8),
        },
        session,
      );
      if (index < 9) {
        await upsert(
          "number_assignments",
          `assignment-${index}`,
          {
            phoneNumberId: numberIds[index],
            customerId: customerIds[index % 3],
            active: true,
            startedAt: date(9),
            createdAt: date(9),
          },
          session,
        );
      }
    }
    await upsert(
      "number_assignments",
      "assignment-previous",
      {
        phoneNumberId: numberIds[0],
        customerId: customerIds[1],
        active: false,
        startedAt: date(8),
        endedAt: date(9),
        createdAt: date(8),
      },
      session,
    );

    const jobs = [
      {
        key: "job-purchase",
        type: "purchase.order",
        status: "succeeded",
        progress: 100,
      },
      {
        key: "job-sync",
        type: "inventory.sync",
        status: "failed",
        progress: 35,
      },
      {
        key: "job-disconnect",
        type: "number.disconnect",
        status: "succeeded",
        progress: 100,
      },
    ] as const;
    for (const job of jobs) {
      await upsert(
        "background_jobs",
        job.key,
        {
          ...base,
          type: job.type,
          payload: { demo: true },
          fingerprint: DEMO,
          status: job.status,
          attempts: 1,
          maxAttempts: 3,
          runAt: date(10),
          progress: job.progress,
          eventSequence: 1,
          finishedAt: date(10),
          ...(job.status === "failed"
            ? {
                failure: {
                  code: "DEMO_SYNC_FAILURE",
                  message: "Sample carrier timeout",
                  retryable: false,
                },
              }
            : { result: { demo: true } }),
        },
        session,
      );
      await upsert(
        "job_events",
        `event-${job.key}`,
        {
          jobId: id(job.key),
          sequence: 1,
          type: job.status,
          message: "Sample job result",
          progress: job.progress,
          createdAt: date(10),
        },
        session,
      );
    }
    await upsert(
      "purchase_orders",
      "purchase-completed",
      {
        ...base,
        idempotencyKey: "demo-purchase-completed",
        requestHash: DEMO,
        actorId: adminId,
        customerId: customerIds[0],
        carrierAccountId: accountId,
        nativeIds: ["demo-native-0", "demo-native-1"],
        jobId: jobIds[0],
        status: "completed",
        nativeOrderId: "DEMO-ORDER-1001",
        items: [
          { e164: numbers[0], status: "confirmed" },
          { e164: numbers[1], status: "confirmed" },
        ],
        unfulfilledCount: 0,
      },
      session,
    );
    await upsert(
      "purchase_orders",
      "purchase-pending",
      {
        ...base,
        idempotencyKey: "demo-purchase-pending",
        requestHash: DEMO,
        actorId: adminId,
        customerId: customerIds[1],
        carrierAccountId: accountId,
        nativeIds: ["demo-offer-1002"],
        jobId: jobIds[0],
        status: "pending",
        items: [],
        unfulfilledCount: 1,
      },
      session,
    );
    await upsert(
      "disconnect_requests",
      "disconnect-completed",
      {
        ...base,
        idempotencyKey: "demo-disconnect-completed",
        requestHash: DEMO,
        phoneNumberId: numberIds[15],
        e164: numbers[15],
        carrierAccountId: accountId,
        actorId: adminId,
        jobId: jobIds[2],
        status: "completed",
        nativeOrderId: "DEMO-DISCONNECT-1001",
      },
      session,
    );
    const portCases = [
      {
        key: "port-draft",
        status: "DRAFT",
        number: "+12025550200",
        customer: 0,
      },
      {
        key: "port-submitted",
        status: "SUBMITTED",
        number: "+12025550201",
        customer: 1,
      },
      {
        key: "port-completed",
        status: "COMPLETED",
        number: "+12025550202",
        customer: 2,
      },
      {
        key: "port-rejected",
        status: "REJECTED",
        number: "+12025550203",
        customer: 0,
      },
    ] as const;
    for (const port of portCases) {
      await upsert(
        "port_requests",
        port.key,
        {
          ...base,
          actorId: adminId,
          customerId: customerIds[port.customer],
          carrierAccountId: accountId,
          numbers: [port.number],
          currentProvider: "Example Telecom",
          accountName: "Demo Account",
          accountNumberEncrypted: crypto.encrypt(Buffer.from("DEMO-ACCOUNT")),
          pinEncrypted: crypto.encrypt(Buffer.from("1234")),
          serviceAddress: {
            line1: "100 Example Street",
            city: "Washington",
            region: "DC",
            postalCode: "20001",
          },
          status: port.status,
          ...(port.status === "REJECTED"
            ? { rejectionReason: "Sample name mismatch" }
            : {}),
        },
        session,
      );
      await upsert(
        "port_request_numbers",
        `port-number-${port.key}`,
        {
          portRequestId: id(port.key),
          e164: port.number,
          status: port.status,
          createdAt: at,
        },
        session,
      );
      await upsert(
        "port_events",
        `port-event-${port.key}`,
        {
          portRequestId: id(port.key),
          type: "port.created",
          actorId: adminId,
          previous: null,
          next: { status: port.status, numbers: [port.number] },
          createdAt: at,
        },
        session,
      );
    }
    await upsert(
      "carrier_sync_runs",
      "sync-success",
      {
        carrierAccountId: accountId,
        status: "succeeded",
        startedAt: date(10),
        finishedAt: date(10),
        seen: 16,
        created: 16,
        updated: 0,
        missing: 0,
        issues: 0,
      },
      session,
    );
    await upsert(
      "carrier_sync_runs",
      "sync-failed",
      {
        carrierAccountId: accountId,
        status: "failed",
        startedAt: date(11),
        finishedAt: date(11),
        seen: 0,
        created: 0,
        updated: 0,
        missing: 0,
        issues: 1,
        errorCode: "DEMO_SYNC_FAILURE",
      },
      session,
    );
    await upsert(
      "reconciliation_issues",
      "issue-open",
      {
        carrierAccountId: accountId,
        phoneNumberId: numberIds[14],
        e164: numbers[14],
        type: "missing_at_carrier",
        status: "open",
        detectedAt: date(11),
      },
      session,
    );
    await upsert(
      "reconciliation_issues",
      "issue-resolved",
      {
        carrierAccountId: accountId,
        phoneNumberId: numberIds[15],
        e164: numbers[15],
        type: "unexpected_reappearance",
        status: "resolved",
        detectedAt: date(10),
        resolvedAt: date(11),
      },
      session,
    );
  });

  const history = [
    {
      key: "assigned",
      type: "number.assigned",
      phoneNumberId: numberIds[0],
      customerId: customerIds[0],
    },
    {
      key: "transferred",
      type: "number.transferred",
      phoneNumberId: numberIds[1],
      customerId: customerIds[1],
    },
    {
      key: "purchased",
      type: "purchase.completed",
      phoneNumberId: numberIds[2],
      customerId: customerIds[2],
    },
  ];
  for (const event of history) {
    await database.withTransaction(async (tx, session) => {
      if (
        await tx
          .table("number_events")
          .findOne({ "next.demoEvent": `${DEMO}:${event.key}` }, { session })
      )
        return;
      await appendAuditEvent(tx, session, {
        type: event.type,
        actorId: adminId,
        customerId: event.customerId,
        phoneNumberId: event.phoneNumberId,
        previous: null,
        next: {
          demoEvent: `${DEMO}:${event.key}`,
          customerId: event.customerId,
        },
      });
    });
  }

  // An encrypted PostgreSQL document keeps the port document download screen usable.
  const documentId = id("port-document");
  if (!(await db.table("port_documents").findOne({ id: documentId }))) {
    const content = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==",
      "base64",
    );
    const fileId = await database.uploadDocument(
      "demo-authorization.png",
      crypto.encrypt(content),
    );
    await db.table("port_documents").insertOne({
      id: documentId,
      portRequestId: portIds[0],
      fileId,
      filename: "demo-authorization.png",
      contentType: "image/png",
      byteLength: content.length,
      createdAt: at,
      demoSeed: DEMO,
    });
  }
}
