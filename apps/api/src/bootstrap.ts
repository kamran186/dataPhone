import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { ApiExceptionFilter } from "./common/api-exception.filter";
import { loadConfig } from "./config/app-config";

export async function createApp(): Promise<INestApplication> {
  const config = loadConfig(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["error", "warn"],
    bodyParser: false,
  });
  app.setGlobalPrefix("api/v1");
  // A 5 MiB document expands to almost 7 MiB when sent as base64 JSON.
  app.useBodyParser("json", { limit: "7mb" });
  app.useBodyParser("urlencoded", { extended: true, limit: "100kb" });
  app.enableCors({ origin: config.corsOrigin, credentials: true });
  app.enableShutdownHooks();
  app.use(
    (
      req: Request & { correlationId?: string },
      res: Response,
      next: NextFunction,
    ) => {
      const supplied = req.header("x-correlation-id");
      req.correlationId =
        supplied && /^[a-zA-Z0-9-]{8,64}$/.test(supplied)
          ? supplied
          : randomUUID();
      res.setHeader("x-correlation-id", req.correlationId);
      res.on("finish", () =>
        process.stdout.write(
          `${JSON.stringify({ level: "info", event: "request", method: req.method, statusCode: res.statusCode, correlationId: req.correlationId })}\n`,
        ),
      );
      next();
    },
  );
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle("DataPhone API").build(),
  );
  SwaggerModule.setup("api/docs", app, document);
  return app;
}
