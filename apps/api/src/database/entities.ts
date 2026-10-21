import type { Id } from "./query";
export interface BaseRecord {
  id: Id;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface CustomerRecord extends BaseRecord {
  name: string;
  externalId: string;
  status: string;
}
