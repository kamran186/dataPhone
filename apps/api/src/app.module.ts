import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth/auth.controller";
import { AuthGuard } from "./auth/auth.guard";
import { AuthService } from "./auth/auth.service";
import { PermissionsGuard } from "./auth/permissions.guard";
import { RolesController, UsersController } from "./auth/users.controller";
import { UsersService } from "./auth/users.service";
import { APP_CONFIG, loadConfig } from "./config/app-config";
import { CarrierRegistryService } from "./carriers/registry";
import { DatabaseHealthService } from "./database/database-health.service";
import { DatabaseService } from "./database/database.service";
import { HealthController } from "./health/health.controller";
import { SystemController } from "./system/system.controller";

@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig(process.env) },
    DatabaseService,
    DatabaseHealthService,
    AuthService,
    UsersService,
    CarrierRegistryService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  controllers: [
    HealthController,
    SystemController,
    AuthController,
    UsersController,
    RolesController,
  ],
})
export class AppModule {}
