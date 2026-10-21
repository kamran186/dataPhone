import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { APP_CONFIG, AppConfig } from "../config/app-config";
import { DatabaseInfrastructure } from "./database.infrastructure";
import { seedCarriers } from "./seed";

@Injectable()
export class DatabaseService
  extends DatabaseInfrastructure
  implements OnModuleDestroy
{
  private ready?: Promise<void>;
  private expiryTimer?: NodeJS.Timeout;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super(config.databaseUrl);
  }

  async ensureReady(): Promise<void> {
    this.ready ??= this.initialize().catch(async (error: unknown) => {
      this.ready = undefined;
      await this.close();
      throw error;
    });
    await this.ready;
    await this.ping();
  }

  private async initialize(): Promise<void> {
    await this.connect();
    await this.initializeSchema();
    await seedCarriers(this);
    await this.cleanupExpiredAuthentication();
    this.expiryTimer = setInterval(() => {
      void this.cleanupExpiredAuthentication().catch(() => undefined);
    }, 60 * 60_000);
    this.expiryTimer.unref();
  }

  private async cleanupExpiredAuthentication(): Promise<void> {
    await this.sql().query(
      'DELETE FROM auth_sessions WHERE "expiresAt" <= now()',
    );
    await this.sql().query(
      'DELETE FROM login_attempts WHERE "expiresAt" <= now()',
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    await this.close();
  }
}
