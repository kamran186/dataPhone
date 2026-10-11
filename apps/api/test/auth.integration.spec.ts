import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "../src/bootstrap";
import { DatabaseService } from "../src/database/database.service";
import { bootstrapAdministrator } from "../src/auth/bootstrap-admin";
import type { UserDocument } from "../src/auth/auth.service";
import { UsersService } from "../src/auth/users.service";

const baseUrl = process.env.DATAPHONE_TEST_MONGO_URL;
const integration = baseUrl ? describe : describe.skip;

integration("employee authentication and permissions", () => {
  let app: INestApplication;
  let database: DatabaseService;
  let previousUri: string | undefined;
  let previousSecret: string | undefined;
  let adminToken: string;
  let refreshCookie: string;
  const email = "admin@example.test";
  const password = "correct horse battery staple 42";

  beforeAll(async () => {
    previousUri = process.env.MONGO_URI;
    previousSecret = process.env.JWT_SECRET;
    const url = new URL(baseUrl ?? "mongodb://127.0.0.1:27017/");
    url.pathname = `/dataphone_phase3_test_${randomUUID().replaceAll("-", "")}`;
    process.env.MONGO_URI = url.toString();
    process.env.JWT_SECRET = "phase3-test-secret-with-at-least-32-bytes";
    app = await createApp();
    await app.init();
    database = app.get(DatabaseService);
    await database.ensureReady();
    await bootstrapAdministrator(database, email, password);
  });

  afterAll(async () => {
    if (database?.isConnected()) await database.nativeDb().dropDatabase();
    await app?.close();
    if (previousUri === undefined) delete process.env.MONGO_URI;
    else process.env.MONGO_URI = previousUri;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });

  it("allows one administrator bootstrap and stores only a password hash", async () => {
    await expect(
      bootstrapAdministrator(database, "another@example.test", password),
    ).rejects.toThrow("already initialized");
    const user = await database.nativeDb().collection("users").findOne({
      emailNormalized: email,
    });
    expect(user?.passwordHash).toBeTruthy();
    expect(JSON.stringify(user)).not.toContain(password);
    const viaTypeOrm = await database
      .repository<UserDocument>("User")
      .findOneBy({ emailNormalized: email });
    expect(viaTypeOrm).toMatchObject({
      email,
      roleKeys: ["SUPER_ADMIN"],
      active: true,
    });
    expect(
      await database
        .nativeDb()
        .collection("schema_migrations")
        .findOne({
          _id: "auth-v1" as never,
        }),
    ).toMatchObject({ version: 1 });
  });

  it("rejects invalid credentials without revealing whether the user exists", async () => {
    const wrong = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password: "wrong-password-123" })
      .expect(401);
    const missing = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "missing@example.test", password: "wrong-password-123" })
      .expect(401);
    expect(wrong.body.message).toBe(missing.body.message);
  });

  it("limits repeated failed logins", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({
          email: "rate-limited@example.test",
          password: "wrong-password-123",
        })
        .expect(401);
    }
    await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({
        email: "rate-limited@example.test",
        password: "wrong-password-123",
      })
      .expect(429);
  });

  it("reserves the final allowed login attempt atomically", async () => {
    const identity = {
      email: "concurrent-limit@example.test",
      password: "wrong-password-123",
    };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send(identity)
        .expect(401);
    }
    const responses = await Promise.all([
      request(app.getHttpServer()).post("/api/v1/auth/login").send(identity),
      request(app.getHttpServer()).post("/api/v1/auth/login").send(identity),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      401, 429,
    ]);
  });

  it("signs in, sets an HttpOnly refresh cookie, and protects user routes", async () => {
    await request(app.getHttpServer()).get("/api/v1/users").expect(401);
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password })
      .expect(201);
    adminToken = login.body.accessToken;
    refreshCookie = login.headers["set-cookie"][0].split(";")[0];
    expect(login.body).not.toHaveProperty("refreshToken");
    expect(login.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(login.headers["set-cookie"][0]).toContain("SameSite=Strict");
    const users = await request(app.getHttpServer())
      .get("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(users.body[0]).toMatchObject({ email, active: true });
    expect(JSON.stringify(users.body)).not.toContain("passwordHash");
  });

  it("rotates refresh tokens and rejects reuse of the previous token", async () => {
    const rotated = await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .set("Cookie", refreshCookie)
      .expect(201);
    const nextCookie = rotated.headers["set-cookie"][0].split(";")[0];
    expect(nextCookie).not.toBe(refreshCookie);
    await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .set("Cookie", refreshCookie)
      .expect(401);
    refreshCookie = nextCookie;
    adminToken = rotated.body.accessToken;
  });

  it("rejects expired and tampered access tokens", async () => {
    const expired = await new SignJWT({ tokenVersion: 1 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("507f1f77bcf86cd799439011")
      .setIssuer("dataphone")
      .setAudience("dataphone-api")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(process.env.JWT_SECRET));
    await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${expired}`)
      .expect(401);
    await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set(
        "Authorization",
        `Bearer ${adminToken.slice(0, -1)}${adminToken.endsWith("a") ? "b" : "a"}`,
      )
      .expect(401);
  });

  it("exposes exactly four initial roles to signed-in employees", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(
      response.body.map((role: { key: string }) => role.key).sort(),
    ).toEqual([
      "OPERATIONS_MANAGER",
      "OPERATIONS_STAFF",
      "SUPER_ADMIN",
      "VIEWER",
    ]);
  });

  it("enforces role permissions and deactivation", async () => {
    const created = await request(app.getHttpServer())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        email: "viewer@example.test",
        password: "viewer password 12345",
        roleKeys: ["VIEWER"],
      })
      .expect(201);
    expect(created.body).not.toHaveProperty("passwordHash");
    const viewerLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "viewer@example.test", password: "viewer password 12345" })
      .expect(201);
    const viewerToken = viewerLogin.body.accessToken;
    await request(app.getHttpServer())
      .get("/api/v1/users")
      .set("Authorization", `Bearer ${viewerToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/users/${created.body.id}/roles`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ roleKeys: ["OPERATIONS_STAFF"] })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/users/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ active: false })
      .expect(200);
    await request(app.getHttpServer())
      .get("/api/v1/permissions")
      .set("Authorization", `Bearer ${viewerToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "viewer@example.test", password: "viewer password 12345" })
      .expect(401);
  });

  it("updates staff identity without exposing credentials", async () => {
    const created = await request(app.getHttpServer())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        email: "staff-old@example.test",
        password: "staff password 12345",
        roleKeys: ["VIEWER"],
      })
      .expect(201);
    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/users/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "staff-new@example.test", displayName: "Staff Member" })
      .expect(200);
    expect(updated.body).toMatchObject({
      email: "staff-new@example.test",
      displayName: "Staff Member",
    });
    expect(JSON.stringify(updated.body)).not.toContain("passwordHash");
    await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({
        email: "staff-old@example.test",
        password: "staff password 12345",
      })
      .expect(401);
    await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({
        email: "staff-new@example.test",
        password: "staff password 12345",
      })
      .expect(201);
  });

  it("logs out and invalidates its access token", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Cookie", refreshCookie)
      .expect(201);
    await request(app.getHttpServer())
      .get("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .set("Cookie", refreshCookie)
      .expect(401);
  });

  it("keeps an active administrator during concurrent deactivation", async () => {
    const users = app.get(UsersService);
    const first = (await users.list()).find((entry) => entry.email === email);
    expect(first).toBeDefined();
    const second = await users.create(
      "second-admin@example.test",
      "second administrator password 42",
      ["SUPER_ADMIN"],
    );
    const outcomes = await Promise.allSettled([
      users.update(first!.id, { active: false }),
      users.update(second.id, { active: false }),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await database.nativeDb().collection("users").countDocuments({
        active: true,
        roleKeys: "SUPER_ADMIN",
      }),
    ).toBe(1);
  });
});
