import type { ObjectId } from "mongodb";
import type { CarrierCode } from "../carriers/domain";

export interface CarrierRecord {
  _id: ObjectId;
  code: CarrierCode;
  displayName: string;
}

export interface CarrierAccountRecord {
  _id: ObjectId;
  carrierId: ObjectId;
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
  _id: ObjectId;
  e164: string;
  carrierId: ObjectId;
  carrierAccountId: ObjectId;
  carrierNumberId: string;
  status: "active" | "missing" | "disconnected";
  firstSeenAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface HoldingRecord {
  _id: ObjectId;
  phoneNumberId: ObjectId;
  carrierAccountId: ObjectId;
  status: "active" | "closed";
  startedAt: Date;
  endedAt?: Date;
  createdAt: Date;
}

export interface SyncRunRecord {
  _id: ObjectId;
  carrierAccountId: ObjectId;
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
  _id: ObjectId;
  carrierAccountId: ObjectId;
  phoneNumberId?: ObjectId;
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
