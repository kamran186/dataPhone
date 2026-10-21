import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { uuid } from "../src/database/query";
import type { INestApplication } from "@nestjs/common";
import { bootstrapAdministrator } from "../src/auth/bootstrap-admin";
import { createApp } from "../src/bootstrap";
import { loadConfig } from "../src/config/app-config";
import { DatabaseService } from "../src/database/database.service";
import { AuditService } from "../src/ownership/audit.service";
import { CustomersService } from "../src/ownership/customers.service";
import { AssignmentsService } from "../src/ownership/assignments.service";

const baseUrl = process.env.DATAPHONE_TEST_DATABASE_URL;
const integration = baseUrl ? describe : describe.skip;

integration("customer ownership and audit history", () => {
  let database: DatabaseService;
  let audit: AuditService;
  let customers: CustomersService;
  let assignments: AssignmentsService;
  let testUri: string;

  beforeAll(async () => {
    const url = new URL(
      baseUrl ?? "postgresql://dataphone:dataphone@127.0.0.1:54329/dataphone",
    );
    url.searchParams.set(
      "schema",
      `dataphone_phase7_test_${randomUUID().replaceAll("-", "")}`,
    );
    testUri = url.toString();
    database = new DatabaseService(
      loadConfig({ DATABASE_URL: testUri, NODE_ENV: "test" }),
    );
    await database.ensureReady();
    audit = new AuditService(database);
    customers = new CustomersService(database, audit);
    assignments = new AssignmentsService(database, audit);
  });

  beforeEach(async () => {
    await database.resetTestTables([
      "customers",
      "number_events",
      "number_assignments",
      "phone_numbers",
    ]);
    await database
      .sql()
      .table("audit_chain_heads")
      .updateOne(
        { id: "global" as never },
        { $set: { sequence: 0, hash: "0".repeat(64) } },
      );
  });

  afterAll(async () => {
    if (database?.isConnected()) await database.dropTestSchema();
    await database?.close();
  });

  it("chains audit events and detects event modification", async () => {
    const actorId = uuid();
    const customerId = uuid();
    await database
      .sql()
      .table("customers")
      .insertOne({ id: customerId, name: "History customer" });
    await database.withTransaction(async (db, session) => {
      await audit.append(db, session, {
        type: "customer.created",
        actorId,
        customerId,
        previous: null,
        next: { name: "Acme", observedAt: new Date("2026-10-21T00:00:00Z") },
      });
      await audit.append(db, session, {
        type: "customer.updated",
        actorId,
        customerId,
        previous: { name: "Acme" },
        next: { name: "Acme West" },
      });
    });
    expect(await audit.verify()).toMatchObject({ valid: true, count: 2 });
    const events = await database
      .sql()
      .table("number_events")
      .find({ customerId })
      .sort({ sequence: 1 })
      .toArray();
    expect(events.map((event) => event.previousHash)).toEqual([
      "0".repeat(64),
      events[0].hash,
    ]);
    expect(events.every((event) => event.actorId === actorId)).toBe(true);
    await database
      .sql()
      .table("number_events")
      .updateOne(
        { id: events[0].id },
        { $set: { next: { name: "Tampered" } } },
      );
    expect(await audit.verify()).toMatchObject({ valid: false });
    await expect(
      database.updateWithVersion("number_events", events[0].id, 0, {
        next: {},
      }),
    ).rejects.toThrow("append-only");
  });

  it("creates and updates a customer with versioned audited state", async () => {
    const actorId = uuid();
    const created = await customers.create(
      { externalId: "acme", name: "Acme" },
      actorId,
    );
    expect(created).toMatchObject({
      externalId: "acme",
      name: "Acme",
      status: "active",
      version: 1,
    });
    const updated = await customers.update(
      uuid(created.id),
      { name: "Acme West", version: 1 },
      actorId,
    );
    expect(updated).toMatchObject({ name: "Acme West", version: 2 });
    await expect(
      customers.update(
        uuid(created.id),
        { name: "Stale", version: 1 },
        actorId,
      ),
    ).rejects.toThrow("changed");
    const events = await database
      .sql()
      .table("number_events")
      .find({ customerId: uuid(created.id) })
      .sort({ sequence: 1 })
      .toArray();
    expect(events.map((event) => event.type)).toEqual([
      "customer.created",
      "customer.updated",
    ]);
    expect(events[1].previous).toMatchObject({ name: "Acme" });
    expect(events[1].next).toMatchObject({ name: "Acme West" });
    expect(await audit.verify()).toMatchObject({ valid: true, count: 2 });
  });

  it("lists customers and their currently assigned numbers", async () => {
    const actorId = uuid();
    const acme = await customers.create(
      { externalId: "acme", name: "Acme West" },
      actorId,
    );
    await customers.create(
      { externalId: "other", name: "Other Company" },
      actorId,
    );
    const numberId = uuid();
    await database.sql().table("phone_numbers").insertOne({
      id: numberId,
      e164: "+18043024183",
      status: "active",
    });
    await database
      .sql()
      .table("number_assignments")
      .insertOne({
        id: uuid(),
        phoneNumberId: numberId,
        customerId: uuid(acme.id),
        active: true,
      });
    expect(
      (await customers.list({ search: "Acme", page: 1, pageSize: 10 })).items,
    ).toMatchObject([{ id: acme.id, name: "Acme West" }]);
    expect(await customers.get(uuid(acme.id))).toMatchObject({
      name: "Acme West",
    });
    expect(
      (
        await customers.numbers(uuid(acme.id), {
          page: 1,
          pageSize: 10,
        })
      ).items,
    ).toMatchObject([{ e164: "+18043024183" }]);
  });

  it("filters number and customer history without changing the chain", async () => {
    const actorId = uuid();
    const customerId = uuid();
    await database
      .sql()
      .table("customers")
      .insertOne({ id: customerId, name: "History customer" });
    const numberId = uuid();
    await database
      .sql()
      .table("phone_numbers")
      .insertOne({ id: numberId, e164: "+18043024183" });
    await database.withTransaction(async (db, session) => {
      await audit.append(db, session, {
        type: "number.assigned",
        actorId,
        customerId,
        phoneNumberId: numberId,
        previous: null,
        next: { customerId: customerId },
      });
      await audit.append(db, session, {
        type: "number.unassigned",
        actorId,
        customerId,
        phoneNumberId: numberId,
        previous: { customerId: customerId },
        next: null,
      });
    });
    expect(
      (
        await audit.numberHistory(numberId, {
          type: "number.assigned",
          page: 1,
          pageSize: 10,
        })
      ).items,
    ).toMatchObject([{ type: "number.assigned" }]);
    expect(
      (await audit.customerHistory(customerId, { page: 1, pageSize: 10 }))
        .total,
    ).toBe(2);
    expect(
      (
        await audit.numberHistory(numberId, {
          to: new Date().toISOString().slice(0, 10),
        })
      ).total,
    ).toBe(2);
    await expect(
      audit.numberHistory(numberId, { from: "bad-date" }),
    ).rejects.toThrow("Invalid history date");
    expect(await audit.verify()).toMatchObject({ valid: true, count: 2 });
  });

  it("assigns, transfers, and unassigns one number with historical periods", async () => {
    const actorId = uuid();
    const firstCustomer = await customers.create(
      { externalId: "first", name: "First Customer" },
      actorId,
    );
    const secondCustomer = await customers.create(
      { externalId: "second", name: "Second Customer" },
      actorId,
    );
    const numberId = uuid();
    await database
      .sql()
      .table("phone_numbers")
      .insertOne({ id: numberId, e164: "+18043024183", status: "active" });
    await assignments.assign(numberId, uuid(firstCustomer.id), actorId);
    await expect(
      assignments.assign(numberId, uuid(secondCustomer.id), actorId),
    ).rejects.toThrow("already assigned");
    await assignments.transfer(numberId, uuid(secondCustomer.id), actorId);
    await assignments.unassign(numberId, actorId);
    const periods = await database
      .sql()
      .table("number_assignments")
      .find({ phoneNumberId: numberId })
      .sort({ startedAt: 1 })
      .toArray();
    expect(periods).toHaveLength(2);
    expect(
      periods.every(
        (period) => !period.active && period.endedAt instanceof Date,
      ),
    ).toBe(true);
    expect(
      (await audit.numberHistory(numberId)).items.map((event) => event.type),
    ).toEqual(["number.unassigned", "number.transferred", "number.assigned"]);
    expect(
      (await audit.customerHistory(uuid(firstCustomer.id))).items.map(
        (event) => event.type,
      ),
    ).toContain("number.transferred");
    expect(await audit.verify()).toMatchObject({ valid: true, count: 5 });
  });

  it("rolls back a bulk assignment when one number is missing", async () => {
    const actorId = uuid();
    const customer = await customers.create(
      { externalId: "bulk", name: "Bulk Customer" },
      actorId,
    );
    const existingId = uuid();
    await database
      .sql()
      .table("phone_numbers")
      .insertOne({ id: existingId, e164: "+18043024183", status: "active" });
    await expect(
      assignments.bulk([existingId, uuid()], uuid(customer.id), actorId),
    ).rejects.toThrow("Number not found");
    expect(await database.sql().table("number_assignments").count()).toBe(0);
    expect(await audit.verify()).toMatchObject({ valid: true, count: 1 });
  });

  it("assigns a batch of distinct numbers in one transaction", async () => {
    const actorId = uuid();
    const customer = await customers.create(
      { externalId: "batch", name: "Batch Customer" },
      actorId,
    );
    const ids = [uuid(), uuid()];
    await database
      .sql()
      .table("phone_numbers")
      .insertMany(
        ids.map((id, index) => ({
          id: id,
          e164: index ? "+18042121778" : "+18043024183",
          status: "active",
        })),
      );
    const result = await assignments.bulk(ids, uuid(customer.id), actorId);
    expect(result).toHaveLength(2);
    expect(
      await database.sql().table("number_assignments").count({ active: true }),
    ).toBe(2);
    expect(await audit.verify()).toMatchObject({ valid: true, count: 3 });
  });

  it("allows only one of two concurrent customers to claim a number", async () => {
    const actorId = uuid();
    const firstCustomer = await customers.create(
      { externalId: "race-a", name: "Race A" },
      actorId,
    );
    const secondCustomer = await customers.create(
      { externalId: "race-b", name: "Race B" },
      actorId,
    );
    const numberId = uuid();
    await database
      .sql()
      .table("phone_numbers")
      .insertOne({ id: numberId, e164: "+18043024183", status: "active" });
    const results = await Promise.allSettled([
      assignments.assign(numberId, uuid(firstCustomer.id), actorId),
      assignments.assign(numberId, uuid(secondCustomer.id), actorId),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await database
        .sql()
        .table("number_assignments")
        .count({ phoneNumberId: numberId, active: true }),
    ).toBe(1);
    expect(await audit.verify()).toMatchObject({ valid: true, count: 3 });
  });

  it("serves protected customer, assignment, and history endpoints", async () => {
    const previousUri = process.env.DATABASE_URL;
    const previousSecret = process.env.JWT_SECRET;
    const previousWorker = process.env.DATAPHONE_JOB_WORKER_DISABLED;
    process.env.DATABASE_URL = testUri;
    process.env.JWT_SECRET = "phase7-test-secret-with-at-least-32-bytes";
    process.env.DATAPHONE_JOB_WORKER_DISABLED = "true";
    let app: INestApplication | undefined;
    try {
      app = await createApp();
      await app.listen(0, "127.0.0.1");
      const address = app.getHttpServer().address() as { port: number };
      const root = `http://127.0.0.1:${address.port}/api/v1`;
      expect((await fetch(`${root}/customers`)).status).toBe(401);
      await bootstrapAdministrator(
        app.get(DatabaseService),
        "ownership-admin@example.test",
        "phase7 secure administrator passphrase",
      );
      const login = await fetch(`${root}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "ownership-admin@example.test",
          password: "phase7 secure administrator passphrase",
        }),
      });
      const { accessToken } = (await login.json()) as { accessToken: string };
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      };
      const created = await fetch(`${root}/customers`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          externalId: "api-customer",
          name: "API Customer",
        }),
      });
      expect(created.status).toBe(201);
      const customer = (await created.json()) as {
        id: string;
        version: number;
      };
      const listed = await fetch(
        `${root}/customers?search=API&page=1&pageSize=10`,
        { headers },
      );
      expect(((await listed.json()) as { total: number }).total).toBe(1);
      expect(
        (
          await fetch(`${root}/customers/${uuid()}`, {
            headers,
          })
        ).status,
      ).toBe(404);
      const duplicate = await fetch(`${root}/customers`, {
        method: "POST",
        headers,
        body: JSON.stringify({ externalId: "api-customer", name: "Duplicate" }),
      });
      expect(duplicate.status).toBe(409);
      const numberId = uuid();
      await database
        .sql()
        .table("phone_numbers")
        .insertOne({ id: numberId, e164: "+18043024183", status: "active" });
      const assigned = await fetch(`${root}/assignments`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          numberId: numberId,
          customerId: customer.id,
        }),
      });
      expect(assigned.status).toBe(201);
      const customerNumbers = await fetch(
        `${root}/customers/${customer.id}/numbers`,
        { headers },
      );
      expect(((await customerNumbers.json()) as { total: number }).total).toBe(
        1,
      );
      const history = await fetch(`${root}/numbers/${numberId}/history`, {
        headers,
      });
      expect(((await history.json()) as { total: number }).total).toBe(1);
      const customerHistory = await fetch(
        `${root}/customers/${customer.id}/history`,
        { headers },
      );
      expect(((await customerHistory.json()) as { total: number }).total).toBe(
        2,
      );
      const changed = await fetch(`${root}/customers/${customer.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          name: "API Customer Updated",
          version: customer.version,
        }),
      });
      expect(changed.status).toBe(200);
      expect((await changed.json()) as { name: string }).toMatchObject({
        name: "API Customer Updated",
      });
      const stale = await fetch(`${root}/customers/${customer.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ name: "Stale Name", version: customer.version }),
      });
      expect(stale.status).toBe(409);
    } finally {
      await app?.close();
      if (previousUri === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUri;
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
      if (previousWorker === undefined)
        delete process.env.DATAPHONE_JOB_WORKER_DISABLED;
      else process.env.DATAPHONE_JOB_WORKER_DISABLED = previousWorker;
    }
  });
});
