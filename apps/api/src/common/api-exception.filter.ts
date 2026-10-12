import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { ApiError } from "@dataphone/shared";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host
      .switchToHttp()
      .getRequest<Request & { correlationId?: string }>();
    const tooLarge =
      error instanceof Error &&
      "status" in error &&
      error.status === HttpStatus.PAYLOAD_TOO_LARGE;
    const statusCode =
      error instanceof HttpException
        ? error.getStatus()
        : tooLarge
          ? HttpStatus.PAYLOAD_TOO_LARGE
          : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw =
      error instanceof HttpException ? error.getResponse() : undefined;
    const message =
      typeof raw === "string"
        ? raw
        : typeof raw === "object" &&
            raw &&
            "message" in raw &&
            typeof raw.message === "string"
          ? raw.message
          : tooLarge
            ? "Request body is too large"
            : error instanceof HttpException
              ? error.message
              : "Internal server error";
    const body: ApiError = {
      statusCode,
      message,
      correlationId: request.correlationId ?? "",
    };
    if (statusCode >= 500)
      process.stderr.write(
        `${JSON.stringify({ level: "error", event: "request_failed", statusCode, correlationId: body.correlationId })}\n`,
      );
    response.status(statusCode).json(body);
  }
}
