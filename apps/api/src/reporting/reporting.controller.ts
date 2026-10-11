import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { RequirePermissions } from "../auth/auth.decorators";
import { reportCsv, reportXlsx } from "./reporting.export";
import { ReportingService } from "./reporting.service";

@Controller()
@RequirePermissions("reports.view")
export class ReportingController {
  constructor(private readonly reports: ReportingService) {}
  @Get("dashboard")
  dashboard() {
    return this.reports.dashboard();
  }
  @Get("reports/:type")
  report(
    @Param("type") type: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.reports.report(type, query);
  }
  @Get("reports/:type/export")
  async export(
    @Param("type") type: string,
    @Query() query: Record<string, string | undefined>,
    @Res() response: Response,
  ) {
    const format = query.format ?? "csv";
    if (!(["csv", "xlsx"] as string[]).includes(format))
      throw new BadRequestException("Invalid export format");
    const report = await this.reports.report(type, query, true);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="dataphone-${report.type}.${format}"`,
    );
    response.setHeader("Cache-Control", "no-store");
    if (format === "xlsx") {
      response.type(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      response.send(await reportXlsx(report.columns, report.rows));
    } else {
      response.type("text/csv; charset=utf-8");
      response.send(reportCsv(report.columns, report.rows));
    }
  }
}
