import { BadRequestException } from "@nestjs/common";
import { Id, uuid } from "../database/query";

export function recordId(raw: string): Id {
  if (
    typeof raw !== "string" ||
    !/^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(
      raw,
    )
  )
    throw new BadRequestException("Invalid ID");
  return uuid(raw);
}

export function pageQuery(raw: Record<string, string | undefined>) {
  return {
    page: raw.page === undefined ? undefined : Number(raw.page),
    pageSize: raw.pageSize === undefined ? undefined : Number(raw.pageSize),
  };
}
