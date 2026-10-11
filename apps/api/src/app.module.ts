import { Module } from "@nestjs/common";
import { APP_CONFIG, loadConfig } from "./config/app-config";
import { DatabaseHealthService } from "./database/database-health.service";
import { DatabaseService } from "./database/database.service";
import { HealthController } from "./health/health.controller";
import { SystemController } from "./system/system.controller";

@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig(process.env) },
    DatabaseService,
    DatabaseHealthService,
  ],
  controllers: [HealthController, SystemController],
})
export class AppModule {}
