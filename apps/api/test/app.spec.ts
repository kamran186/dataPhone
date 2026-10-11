import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createApp } from "../src/bootstrap";
import { loadConfig } from "../src/config/app-config";
import { DatabaseHealthService } from "../src/database/database-health.service";
import { DatabaseService } from "../src/database/database.service";

describe("configuration", () => {
  it("requires a named MongoDB database", () => {
    expect(() =>
      loadConfig({ MONGO_URI: "mongodb://localhost:27017/" }),
    ).toThrow("explicit database name");
    expect(() => loadConfig({})).toThrow("MONGO_URI is required");
  });

  it("rejects invalid ports", () => {
    expect(() =>
      loadConfig({
        MONGO_URI: "mongodb://localhost:27017/dataphone",
        PORT: "0",
      }),
    ).toThrow("PORT");
  });

  it("requires a strong JWT secret in production", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        MONGO_URI: "mongodb://localhost:27017/dataphone",
      }),
    ).toThrow("JWT_SECRET is required");
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        MONGO_URI: "mongodb://localhost:27017/dataphone",
        JWT_SECRET: "too-short",
      }),
    ).toThrow("at least 32 bytes");
  });
});

describe("HTTP foundation", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.MONGO_URI ??=
      "mongodb://127.0.0.1:27186/dataphone_phase1?replicaSet=rs_dataphone_phase0";
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves liveness and a correlation ID", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/health/live")
      .expect(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["x-correlation-id"]).toMatch(/[a-zA-Z0-9-]{8,64}/);
  });

  it("serves system information", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/system/info")
      .expect(200);
    expect(response.body.name).toBe("DataPhone");
  });

  it("reports database readiness when an isolated replica set is available", async () => {
    if (!process.env.DATAPHONE_TEST_MONGO_URL) return;
    await request(app.getHttpServer()).get("/api/v1/health/ready").expect(200);
    const database = app.get(DatabaseService);
    expect(
      await database
        .nativeDb()
        .collection("schema_migrations")
        .countDocuments({
          _id: "core-v1" as never,
        }),
    ).toBe(1);
  });

  it("reports unavailable when the database ping fails", async () => {
    const database = app.get(DatabaseHealthService);
    const ping = database.ping;
    database.ping = async () => {
      throw new Error("probe failure");
    };
    try {
      const response = await request(app.getHttpServer())
        .get("/api/v1/health/ready")
        .expect(503);
      expect(response.body.message).toBe("Database is unavailable");
    } finally {
      database.ping = ping;
    }
  });

  it("returns structured errors", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/missing")
      .expect(404);
    expect(response.body).toMatchObject({ statusCode: 404 });
    expect(response.body.correlationId).toBe(
      response.headers["x-correlation-id"],
    );
  });
});
