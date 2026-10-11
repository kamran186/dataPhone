import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { INestApplication } from "@nestjs/common";
import { bootstrapAdministrator } from "../src/auth/bootstrap-admin";
import { createApp } from "../src/bootstrap";
import { loadConfig } from "../src/config/app-config";
import { DatabaseService } from "../src/database/database.service";
import { AuditService } from "../src/ownership/audit.service";
import { CustomersService } from "../src/ownership/customers.service";
import { AssignmentsService } from "../src/ownership/assignments.service";

const baseUrl = process.env.DATAPHONE_TEST_MONGO_URL;
const integration = baseUrl ? describe : describe.skip;

integration("customer ownership and audit history", () => {
  let database: DatabaseService;
  let audit: AuditService;
  let customers: CustomersService;
  let assignments: AssignmentsService;
  let testUri: string;

  beforeAll(async () => {
    const url = new URL(baseUrl ?? "mongodb://127.0.0.1:27017/");
    url.pathname = `/dataphone_phase7_test_${randomUUID().replaceAll("-", "")}`;
    testUri = url.toString();
    database = new DatabaseService(
      loadConfig({ MONGO_URI: testUri, NODE_ENV: "test" }),
    );
    await database.ensureReady();
    audit = new AuditService(database);
    customers = new CustomersService(database, audit);
    assignments = new AssignmentsService(database, audit);
  });

  beforeEach(async () => {
    for (const name of [
      "customers",
      "number_events",
      "number_assignments",
      "phone_numbers",
    ])
      await database.nativeDb().collection(name).deleteMany({});
    await database
      .nativeDb()
      .collection("audit_chain_heads")
      .updateOne(
        { _id: "global" as never },
        { $set: { sequence: 0, hash: "0".repeat(64) } },
      );
  });

  afterAll(async () => {
    if (database?.isConnected()) await database.nativeDb().dropDatabase();
    await database?.close();
  });

  it("chains audit events and detects event modification", async () => {
    const actorId = new ObjectId();
    const customerId = new ObjectId();
    await database.withTransaction(async (db, session) => {
      await audit.append(db, session, {
        type: "customer.created",
        actorId,
        customerId,
        previous: null,
        next: { name: "Acme" },
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
      .nativeDb()
      .collection("number_events")
      .find({ customerId })
      .sort({ sequence: 1 })
      .toArray();
    expect(events.map((event) => event.previousHash)).toEqual([
      "0".repeat(64),
      events[0].hash,
    ]);
    expect(events.every((event) => event.actorId.equals(actorId))).toBe(true);
    await database
      .nativeDb()
      .collection("number_events")
      .updateOne(
        { _id: events[0]._id },
        { $set: { next: { name: "Tampered" } } },
      );
    expect(await audit.verify()).toMatchObject({ valid: false });
    await expect(
      database.updateWithVersion("number_events", events[0]._id, 0, {
        next: {},
      }),
    ).rejects.toThrow("append-only");
  });

  it("creates and updates a customer with versioned audited state", async () => {
    const actorId = new ObjectId();
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
      new ObjectId(created.id),
      { name: "Acme West", version: 1 },
      actorId,
    );
    expect(updated).toMatchObject({ name: "Acme West", version: 2 });
    await expect(
      customers.update(
        new ObjectId(created.id),
        { name: "Stale", version: 1 },
        actorId,
      ),
    ).rejects.toThrow("changed");
    const events = await database
      .nativeDb()
      .collection("number_events")
      .find({ customerId: new ObjectId(created.id) })
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
    const actorId = new ObjectId();
    const acme = await customers.create(
      { externalId: "acme", name: "Acme West" },
      actorId,
    );
    await customers.create(
      { externalId: "other", name: "Other Company" },
      actorId,
    );
    const numberId = new ObjectId();
    await database.nativeDb().collection("phone_numbers").insertOne({
      _id: numberId,
      e164: "+18043024183",
      status: "active",
    });
    await database
      .nativeDb()
      .collection("number_assignments")
      .insertOne({
        _id: new ObjectId(),
        phoneNumberId: numberId,
        customerId: new ObjectId(acme.id),
        active: true,
      });
    expect(
      (await customers.list({ search: "Acme", page: 1, pageSize: 10 })).items,
    ).toMatchObject([{ id: acme.id, name: "Acme West" }]);
    expect(await customers.get(new ObjectId(acme.id))).toMatchObject({
      name: "Acme West",
    });
    expect(
      (
        await customers.numbers(new ObjectId(acme.id), {
          page: 1,
          pageSize: 10,
        })
      ).items,
    ).toMatchObject([{ e164: "+18043024183" }]);
  });

  it("filters number and customer history without changing the chain", async () => {
    const actorId = new ObjectId();
    const customerId = new ObjectId();
    const numberId = new ObjectId();
    await database.withTransaction(async (db, session) => {
      await audit.append(db, session, {
        type: "number.assigned",
        actorId,
        customerId,
        phoneNumberId: numberId,
        previous: null,
        next: { customerId: customerId.toHexString() },
      });
      await audit.append(db, session, {
        type: "number.unassigned",
        actorId,
        customerId,
        phoneNumberId: numberId,
        previous: { customerId: customerId.toHexString() },
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
    const actorId = new ObjectId();
    const firstCustomer = await customers.create(
      { externalId: "first", name: "First Customer" },
      actorId,
    );
    const secondCustomer = await customers.create(
      { externalId: "second", name: "Second Customer" },
      actorId,
    );
    const numberId = new ObjectId();
    await database
      .nativeDb()
      .collection("phone_numbers")
      .insertOne({ _id: numberId, e164: "+18043024183", status: "active" });
    await assignments.assign(numberId, new ObjectId(firstCustomer.id), actorId);
    await expect(
      assignments.assign(numberId, new ObjectId(secondCustomer.id), actorId),
    ).rejects.toThrow("already assigned");
    await assignments.transfer(
      numberId,
      new ObjectId(secondCustomer.id),
      actorId,
    );
    await assignments.unassign(numberId, actorId);
    const periods = await database
      .nativeDb()
      .collection("number_assignments")
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
      (await audit.customerHistory(new ObjectId(firstCustomer.id))).items.map(
        (event) => event.type,
      ),
    ).toContain("number.transferred");
    expect(await audit.verify()).toMatchObject({ valid: true, count: 5 });
  });

  it("rolls back a bulk assignment when one number is missing", async () => {
    const actorId = new ObjectId();
    const customer = await customers.create(
      { externalId: "bulk", name: "Bulk Customer" },
      actorId,
    );
    const existingId = new ObjectId();
    await database
      .nativeDb()
      .collection("phone_numbers")
      .insertOne({ _id: existingId, e164: "+18043024183", status: "active" });
    await expect(
      assignments.bulk(
        [existingId, new ObjectId()],
        new ObjectId(customer.id),
        actorId,
      ),
    ).rejects.toThrow("Number not found");
    expect(
      await database
        .nativeDb()
        .collection("number_assignments")
        .countDocuments(),
    ).toBe(0);
    expect(await audit.verify()).toMatchObject({ valid: true, count: 1 });
  });

  it("assigns a batch of distinct numbers in one transaction", async () => {
    const actorId = new ObjectId();
    const customer = await customers.create(
      { externalId: "batch", name: "Batch Customer" },
      actorId,
    );
    const ids = [new ObjectId(), new ObjectId()];
    await database
      .nativeDb()
      .collection("phone_numbers")
      .insertMany(
        ids.map((id, index) => ({
          _id: id,
          e164: index ? "+18042121778" : "+18043024183",
          status: "active",
        })),
      );
    const result = await assignments.bulk(
      ids,
      new ObjectId(customer.id),
      actorId,
    );
    expect(result).toHaveLength(2);
    expect(
      await database
        .nativeDb()
        .collection("number_assignments")
        .countDocuments({ active: true }),
    ).toBe(2);
    expect(await audit.verify()).toMatchObject({ valid: true, count: 3 });
  });

  it("allows only one of two concurrent customers to claim a number", async () => {
    const actorId = new ObjectId();
    const firstCustomer = await customers.create(
      { externalId: "race-a", name: "Race A" },
      actorId,
    );
    const secondCustomer = await customers.create(
      { externalId: "race-b", name: "Race B" },
      actorId,
    );
    const numberId = new ObjectId();
    await database
      .nativeDb()
      .collection("phone_numbers")
      .insertOne({ _id: numberId, e164: "+18043024183", status: "active" });
    const results = await Promise.allSettled([
      assignments.assign(numberId, new ObjectId(firstCustomer.id), actorId),
      assignments.assign(numberId, new ObjectId(secondCustomer.id), actorId),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await database
        .nativeDb()
        .collection("number_assignments")
        .countDocuments({ phoneNumberId: numberId, active: true }),
    ).toBe(1);
    expect(await audit.verify()).toMatchObject({ valid: true, count: 3 });
  });

  it("serves protected customer, assignment, and history endpoints", async () => {
    const previousUri = process.env.MONGO_URI;
    const previousSecret = process.env.JWT_SECRET;
    const previousWorker = process.env.DATAPHONE_JOB_WORKER_DISABLED;
    process.env.MONGO_URI = testUri;
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
          await fetch(`${root}/customers/${new ObjectId().toHexString()}`, {
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
      const numberId = new ObjectId();
      await database
        .nativeDb()
        .collection("phone_numbers")
        .insertOne({ _id: numberId, e164: "+18043024183", status: "active" });
      const assigned = await fetch(`${root}/assignments`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          numberId: numberId.toHexString(),
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
      const history = await fetch(
        `${root}/numbers/${numberId.toHexString()}/history`,
        { headers },
      );
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
      if (previousUri === undefined) delete process.env.MONGO_URI;
      else process.env.MONGO_URI = previousUri;
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
      if (previousWorker === undefined)
        delete process.env.DATAPHONE_JOB_WORKER_DISABLED;
      else process.env.DATAPHONE_JOB_WORKER_DISABLED = previousWorker;
    }
  });
});
