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

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super(config.mongoUri);
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
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
