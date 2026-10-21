import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { Id, uuid } from "../database/query";
import { RequirePermissions } from "../auth/auth.decorators";
import { CARRIER_CODES, type CarrierCode } from "../carriers/domain";
import { JobStore } from "../jobs/job.store";
import { toCsv, toXlsx } from "./inventory.export";
import { InventoryService } from "./inventory.service";

function id(value: string): Id {
  if (
    !/^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(
      value,
    )
  )
    throw new BadRequestException("Invalid ID");
  return uuid(value);
}

function query(raw: Record<string, string | undefined>) {
  const page = raw.page ? Number(raw.page) : 1;
  const pageSize = raw.pageSize ? Number(raw.pageSize) : 50;
  const carrier = raw.carrier;
  if (carrier && !CARRIER_CODES.includes(carrier as CarrierCode))
    throw new BadRequestException("Invalid carrier filter");
  const status = raw.status;
  if (status && !["active", "missing", "disconnected"].includes(status))
    throw new BadRequestException("Invalid status filter");
  const sort = raw.sort;
  if (sort && !["e164", "updatedAt", "status"].includes(sort))
    throw new BadRequestException("Invalid sort field");
  const direction = raw.direction;
  if (direction && !["asc", "desc"].includes(direction))
    throw new BadRequestException("Invalid sort direction");
  return {
    search: raw.search,
    customer: raw.customer,
    carrier: carrier as CarrierCode | undefined,
    status: status as "active" | "missing" | "disconnected" | undefined,
    page,
    pageSize,
    sort: sort as "e164" | "updatedAt" | "status" | undefined,
    direction: direction as "asc" | "desc" | undefined,
  };
}

@Controller("numbers")
@RequirePermissions("inventory.view")
export class NumbersController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  list(@Query() raw: Record<string, string | undefined>) {
    return this.inventory.listNumbers(query(raw));
  }

  @Get("export")
  async export(
    @Query() raw: Record<string, string | undefined>,
    @Res() response: Response,
  ) {
    const format = raw.format ?? "csv";
    if (!["csv", "xlsx"].includes(format))
      throw new BadRequestException("Invalid export format");
    const rows = await this.inventory.exportNumbers(query(raw));
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="dataphone-inventory.${format}"`,
    );
    response.setHeader("Cache-Control", "no-store");
    if (format === "xlsx") {
      response.type(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      response.send(await toXlsx(rows));
    } else {
      response.type("text/csv; charset=utf-8");
      response.send(toCsv(rows));
    }
  }

  @Get(":id")
  get(@Param("id") raw: string) {
    return this.inventory.getNumber(id(raw));
  }
}

@Controller("carriers")
export class CarriersController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly jobs: JobStore,
  ) {}

  @Get()
  @RequirePermissions("inventory.view")
  list() {
    return this.inventory.listCarriers();
  }

  @Post(":id/accounts")
  @RequirePermissions("carriers.configure")
  configure(
    @Param("id") carrierId: string,
    @Body() body: { externalAccountId?: string; credentialRef?: string },
  ) {
    if (!body.externalAccountId)
      throw new BadRequestException("Carrier account ID required");
    return this.inventory.configureAccount(
      id(carrierId),
      body.externalAccountId,
      body.credentialRef,
    );
  }

  @Post(":id/sync")
  @RequirePermissions("sync.trigger")
  async sync(@Param("id") accountId: string) {
    const job = await this.jobs.create({
      type: "inventory.sync",
      payload: { accountId: id(accountId) },
      maxAttempts: 3,
    });
    return { jobId: job.id, status: job.status };
  }
}

@Controller("reconciliation")
export class ReconciliationController {
  constructor(private readonly inventory: InventoryService) {}

  @Get("issues")
  @RequirePermissions("inventory.manage")
  list(@Query("status") status?: string) {
    if (status && !["open", "resolved"].includes(status))
      throw new BadRequestException("Invalid issue status");
    return this.inventory.listIssues(status as "open" | "resolved" | undefined);
  }
}
