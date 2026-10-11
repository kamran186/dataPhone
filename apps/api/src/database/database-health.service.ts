import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { MongoClient } from "mongodb";
import { APP_CONFIG, AppConfig } from "../config/app-config";

@Injectable()
export class DatabaseHealthService implements OnModuleDestroy {
  private readonly client: MongoClient;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = new MongoClient(config.mongoUri, {
      serverSelectionTimeoutMS: 1000,
    });
  }

  async ping(): Promise<void> {
    await this.client.db().command({ ping: 1 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.close();
  }
}
