import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseHealthService } from "../database/database-health.service";

@Controller("health")
export class HealthController {
  constructor(private readonly database: DatabaseHealthService) {}

  @Get("live")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  async ready(): Promise<{ status: "ready" }> {
    try {
      await this.database.ping();
      return { status: "ready" };
    } catch {
      throw new ServiceUnavailableException("Database is unavailable");
    }
  }
}
