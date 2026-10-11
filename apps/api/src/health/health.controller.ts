import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "../auth/auth.decorators";
import { DatabaseHealthService } from "../database/database-health.service";

@Controller("health")
@Public()
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
