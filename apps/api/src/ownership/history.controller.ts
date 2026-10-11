import { Controller, Get, Param, Query } from "@nestjs/common";
import { RequirePermissions } from "../auth/auth.decorators";
import { AuditService } from "./audit.service";
import { objectId, pageQuery } from "./ownership.http";

function filter(raw: Record<string, string | undefined>) {
  return { type: raw.type, from: raw.from, to: raw.to, ...pageQuery(raw) };
}

@Controller()
@RequirePermissions("audit.view")
export class HistoryController {
  constructor(private readonly audit: AuditService) {}

  @Get("numbers/:id/history")
  number(
    @Param("id") raw: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.audit.numberHistory(objectId(raw), filter(query));
  }

  @Get("customers/:id/history")
  customer(
    @Param("id") raw: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.audit.customerHistory(objectId(raw), filter(query));
  }
}
