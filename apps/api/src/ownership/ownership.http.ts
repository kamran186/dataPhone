import { BadRequestException } from "@nestjs/common";
import { ObjectId } from "mongodb";

export function objectId(raw: string): ObjectId {
  if (typeof raw !== "string" || !/^[a-f\d]{24}$/i.test(raw))
    throw new BadRequestException("Invalid ID");
  return new ObjectId(raw);
}

export function pageQuery(raw: Record<string, string | undefined>) {
  return {
    page: raw.page === undefined ? undefined : Number(raw.page),
    pageSize: raw.pageSize === undefined ? undefined : Number(raw.pageSize),
  };
}
