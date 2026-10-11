import { Injectable } from "@nestjs/common";
import { DatabaseService } from "./database.service";

@Injectable()
export class DatabaseHealthService {
  constructor(private readonly database: DatabaseService) {}

  async ping(): Promise<void> {
    await this.database.ensureReady();
  }
}
