import { Id } from "../database/query";
import type { CarrierCode } from "../carriers/domain";

export interface CarrierRecord {
  id: Id;
  code: CarrierCode;
  displayName: string;
}

export interface CarrierAccountRecord {
  id: Id;
  carrierId: Id;
  externalAccountId: string;
  credentialRef?: string;
  status: "active" | "disabled";
  syncLeaseUntil?: Date;
  syncLeaseToken?: string;
  lastSyncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PhoneNumberRecord {
  id: Id;
  e164: string;
  carrierId: Id;
  carrierAccountId: Id;
  carrierNumberId: string;
  status: "active" | "missing" | "disconnected";
  firstSeenAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface HoldingRecord {
  id: Id;
  phoneNumberId: Id;
  carrierAccountId: Id;
  status: "active" | "closed";
  startedAt: Date;
  endedAt?: Date;
  createdAt: Date;
}

export interface SyncRunRecord {
  id: Id;
  carrierAccountId: Id;
  status: "running" | "succeeded" | "failed";
  startedAt: Date;
  finishedAt?: Date;
  seen: number;
  created: number;
  updated: number;
  missing: number;
  issues: number;
  errorCode?: string;
}

export interface ReconciliationIssueRecord {
  id: Id;
  carrierAccountId: Id;
  phoneNumberId?: Id;
  e164: string;
  type:
    | "duplicate_carrier"
    | "missing_at_carrier"
    | "unexpected_reappearance"
    | "purchase_conflict"
    | "port_conflict";
  status: "open" | "resolved";
  detectedAt: Date;
  resolvedAt?: Date;
}
