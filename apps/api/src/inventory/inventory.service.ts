import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseError, Filter, Id, uuid } from "../database/query";
import { CarrierRegistryService } from "../carriers/registry";
import type {
  CarrierAccount,
  CarrierCode,
  InventoryNumber,
} from "../carriers/domain";
import { CarrierError } from "../carriers/errors";
import { DatabaseService } from "../database/database.service";
import { normalizeE164 } from "../database/phone-number";

import type {
  CarrierAccountRecord,
  CarrierRecord,
  HoldingRecord,
  PhoneNumberRecord,
  ReconciliationIssueRecord,
  SyncRunRecord,
} from "./inventory.types";

const MAX_PAGES = 1_000;
const MAX_NUMBERS = 100_000;

@Injectable()
export class InventoryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly carriers: CarrierRegistryService,
  ) {}

  async listCarriers() {
    await this.database.ensureReady();
    const db = this.database.sql();
    const carriers = await db
      .table<CarrierRecord>("carriers")
      .find()
      .sort({ code: 1 })
      .toArray();
    const accounts = await db
      .table<CarrierAccountRecord>("carrier_accounts")
      .find()
      .toArray();
    const latestRuns = await Promise.all(
      accounts.map((account) =>
        db
          .table<SyncRunRecord>("carrier_sync_runs")
          .findOne(
            { carrierAccountId: account.id },
            { sort: { startedAt: -1 } },
          ),
      ),
    );
    const runMap = new Map(
      accounts.map((account, index) => [account.id, latestRuns[index]]),
    );
    return carriers.map((carrier) => ({
      id: carrier.id,
      code: carrier.code,
      displayName: carrier.displayName,
      capabilities: this.carriers.capabilities(carrier.code),
      accounts: accounts
        .filter((account) => account.carrierId === carrier.id)
        .map((account) => ({
          id: account.id,
          externalAccountId: account.externalAccountId,
          status: account.status,
          lastSyncedAt: account.lastSyncedAt,
          lastSync: runMap.get(account.id) && {
            status: runMap.get(account.id)!.status,
            startedAt: runMap.get(account.id)!.startedAt,
            finishedAt: runMap.get(account.id)!.finishedAt,
            seen: runMap.get(account.id)!.seen,
            issues: runMap.get(account.id)!.issues,
            errorCode: runMap.get(account.id)!.errorCode,
          },
        })),
    }));
  }

  async configureAccount(
    carrierId: Id,
    externalAccountId: string,
    credentialRef?: string,
  ) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(externalAccountId))
      throw new BadRequestException("Invalid carrier account ID");
    if (credentialRef && !/^[A-Z][A-Z0-9_]{1,63}$/.test(credentialRef))
      throw new BadRequestException("Invalid credential reference");
    await this.database.ensureReady();
    const db = this.database.sql();
    const carrier = await db
      .table<CarrierRecord>("carriers")
      .findOne({ id: carrierId });
    if (!carrier) throw new NotFoundException("Carrier not found");
    const now = new Date();
    try {
      const result = await db
        .table<CarrierAccountRecord>("carrier_accounts")
        .findOneAndUpdate(
          { carrierId, externalAccountId },
          {
            $set: { credentialRef, updatedAt: now },
            $setOnInsert: { status: "active", createdAt: now },
          },
          { upsert: true, returnDocument: "after" },
        );
      return {
        id: result!.id,
        carrier: carrier.code,
        externalAccountId,
        status: result!.status,
      };
    } catch (error) {
      if (error instanceof DatabaseError && error.code === "23505")
        throw new ConflictException("Carrier account already exists");
      throw error;
    }
  }

  async listNumbers(input: {
    search?: string;
    customer?: string;
    carrier?: CarrierCode;
    status?: "active" | "missing" | "disconnected";
    page?: number;
    pageSize?: number;
    sort?: "e164" | "updatedAt" | "status";
    direction?: "asc" | "desc";
  }) {
    await this.database.ensureReady();
    const db = this.database.sql();
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 50;
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 10_000 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 200
    )
      throw new BadRequestException("Invalid inventory page");
    const filter: Filter<PhoneNumberRecord> = {};
    if (input.search) {
      const digits = input.search.replace(/[().\s+-]/g, "");
      if (!/^\d{2,15}$/.test(digits))
        throw new BadRequestException("Invalid number search");
      filter.e164 = { $regex: digits };
    }
    if (input.status) filter.status = input.status;
    if (input.carrier) {
      const carrier = await db
        .table<CarrierRecord>("carriers")
        .findOne({ code: input.carrier });
      if (!carrier) return { items: [], total: 0, page, pageSize };
      filter.carrierId = carrier.id;
    }
    if (input.customer) {
      const name = input.customer.trim();
      if (name.length < 2 || name.length > 100)
        throw new BadRequestException("Invalid customer search");
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const customers = await db
        .table("customers")
        .find(
          { name: { $regex: escaped, $options: "i" } },
          { projection: { id: 1 } },
        )
        .limit(1_001)
        .toArray();
      if (customers.length > 1_000)
        throw new BadRequestException("Customer search is too broad");
      const assignments = await db
        .table("number_assignments")
        .find(
          {
            customerId: { $in: customers.map((item) => item.id) },
            active: true,
          },
          { projection: { phoneNumberId: 1 } },
        )
        .limit(100_001)
        .toArray();
      if (assignments.length > 100_000)
        throw new BadRequestException("Customer search is too broad");
      filter.id = {
        $in: assignments.map((item) => item.phoneNumberId as Id),
      };
    }
    const sort = input.sort ?? "e164";
    const direction = input.direction === "desc" ? -1 : 1;
    const collection = db.table<PhoneNumberRecord>("phone_numbers");
    const [total, numbers] = await Promise.all([
      collection.count(filter),
      collection
        .find(filter)
        .sort({ [sort]: direction, id: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
    ]);
    const accounts = await db
      .table<CarrierAccountRecord>("carrier_accounts")
      .find({ id: { $in: numbers.map((number) => number.carrierAccountId) } })
      .toArray();
    const accountMap = new Map(
      accounts.map((account) => [account.id, account]),
    );
    const carriers = await db
      .table<CarrierRecord>("carriers")
      .find({ id: { $in: numbers.map((number) => number.carrierId) } })
      .toArray();
    const carrierMap = new Map(
      carriers.map((carrier) => [carrier.id, carrier]),
    );
    const assignments = await db
      .table("number_assignments")
      .find({
        phoneNumberId: { $in: numbers.map((number) => number.id) },
        active: true,
      })
      .toArray();
    const customerIds = assignments.map(
      (assignment) => assignment.customerId as Id,
    );
    const customers = await db
      .table("customers")
      .find({ id: { $in: customerIds } })
      .toArray();
    const customerMap = new Map(
      customers.map((customer) => [customer.id, customer]),
    );
    return {
      items: numbers.map((number) => {
        const assignment = assignments.find(
          (item) => item.phoneNumberId === number.id,
        );
        const customer =
          assignment && customerMap.get(assignment.customerId as Id);
        return {
          id: number.id,
          e164: number.e164,
          status: number.status,
          carrier: carrierMap.get(number.carrierId)?.code,
          carrierAccount: accountMap.get(number.carrierAccountId)
            ?.externalAccountId,
          customerName: customer?.name as string | undefined,
          updatedAt: number.updatedAt,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  async getNumber(id: Id) {
    await this.database.ensureReady();
    const db = this.database.sql();
    const number = await db
      .table<PhoneNumberRecord>("phone_numbers")
      .findOne({ id: id });
    if (!number) throw new NotFoundException("Number not found");
    const [carrier, account, holdings, assignments] = await Promise.all([
      db.table<CarrierRecord>("carriers").findOne({ id: number.carrierId }),
      db
        .table<CarrierAccountRecord>("carrier_accounts")
        .findOne({ id: number.carrierAccountId }),
      db
        .table<HoldingRecord>("number_holdings")
        .find({ phoneNumberId: id })
        .sort({ startedAt: -1 })
        .toArray(),
      db
        .table("number_assignments")
        .find({ phoneNumberId: id })
        .sort({ createdAt: -1 })
        .toArray(),
    ]);
    return {
      id: number.id,
      e164: number.e164,
      status: number.status,
      carrier: carrier?.code,
      carrierAccount: account?.externalAccountId,
      firstSeenAt: number.firstSeenAt,
      lastSeenAt: number.lastSeenAt,
      holdings: holdings.map((holding) => ({
        status: holding.status,
        startedAt: holding.startedAt,
        endedAt: holding.endedAt,
      })),
      assignments: assignments.map((assignment) => ({
        customerId: assignment.customerId as Id,
        active: assignment.active as boolean,
        startedAt: assignment.startedAt as Date | undefined,
        endedAt: assignment.endedAt as Date | undefined,
      })),
    };
  }

  async listIssues(status?: "open" | "resolved") {
    await this.database.ensureReady();
    const issues = await this.database
      .sql()
      .table<ReconciliationIssueRecord>("reconciliation_issues")
      .find(status ? { status } : {})
      .sort({ detectedAt: -1 })
      .limit(200)
      .toArray();
    return issues.map((issue) => ({
      id: issue.id,
      e164: issue.e164,
      type: issue.type,
      status: issue.status,
      detectedAt: issue.detectedAt,
      resolvedAt: issue.resolvedAt,
      carrierAccountId: issue.carrierAccountId,
    }));
  }

  async exportNumbers(input: Parameters<InventoryService["listNumbers"]>[0]) {
    const first = await this.listNumbers({ ...input, page: 1, pageSize: 200 });
    if (first.total > 10_000)
      throw new BadRequestException(
        "Export exceeds 10000 numbers; narrow the filters",
      );
    const items = [...first.items];
    for (let page = 2; items.length < first.total; page += 1) {
      const batch = await this.listNumbers({ ...input, page, pageSize: 200 });
      items.push(...batch.items);
      if (!batch.items.length) break;
    }
    return items;
  }

  async sync(accountId: Id, signal?: AbortSignal): Promise<SyncRunRecord> {
    await this.database.ensureReady();
    const db = this.database.sql();
    const accounts = db.table<CarrierAccountRecord>("carrier_accounts");
    const token = randomUUID();
    const now = new Date();
    const account = await accounts.findOneAndUpdate(
      {
        id: accountId,
        status: "active",
        $or: [
          { syncLeaseUntil: { $exists: false } },
          { syncLeaseUntil: { $lte: now } },
        ],
      },
      {
        $set: {
          syncLeaseToken: token,
          syncLeaseUntil: new Date(now.getTime() + 10 * 60_000),
        },
      },
      { returnDocument: "after" },
    );
    if (!account) {
      if (!(await accounts.findOne({ id: accountId })))
        throw new NotFoundException("Carrier account not found");
      throw new ConflictException(
        "Carrier account is already syncing or disabled",
      );
    }
    const carrier = await db
      .table<CarrierRecord>("carriers")
      .findOne({ id: account.carrierId });
    if (!carrier) throw new NotFoundException("Carrier not found");
    const run: SyncRunRecord = {
      id: uuid(),
      carrierAccountId: accountId,
      status: "running",
      startedAt: now,
      seen: 0,
      created: 0,
      updated: 0,
      missing: 0,
      issues: 0,
    };
    await db.table<SyncRunRecord>("carrier_sync_runs").insertOne(run);
    try {
      const snapshot = await this.fetchCompleteSnapshot(
        {
          id: accountId,
          carrier: carrier.code,
          nativeAccountId: account.externalAccountId,
          credentialRef: account.credentialRef,
        },
        signal,
      );
      run.seen = snapshot.size;
      for (const number of snapshot.values()) {
        if (signal?.aborted)
          throw new Error("Inventory synchronization interrupted");
        const result = await this.upsertNumber(account, number);
        run[result] += 1;
      }
      const current = await db
        .table<PhoneNumberRecord>("phone_numbers")
        .find({ carrierAccountId: accountId, status: "active" })
        .toArray();
      for (const number of current) {
        if (signal?.aborted)
          throw new Error("Inventory synchronization interrupted");
        if (!snapshot.has(number.e164)) {
          if (await this.markMissing(number)) run.missing += 1;
        }
      }
      run.status = "succeeded";
      run.finishedAt = new Date();
      await accounts.updateOne(
        { id: accountId, syncLeaseToken: token },
        { $set: { lastSyncedAt: run.finishedAt, updatedAt: run.finishedAt } },
      );
    } catch (error) {
      run.status = "failed";
      run.finishedAt = new Date();
      run.errorCode =
        error instanceof CarrierError ? error.kind : "SYNC_FAILED";
      throw error;
    } finally {
      await db
        .table<SyncRunRecord>("carrier_sync_runs")
        .replaceOne({ id: run.id }, run);
      await accounts.updateOne(
        { id: accountId, syncLeaseToken: token },
        { $unset: { syncLeaseToken: "", syncLeaseUntil: "" } },
      );
    }
    return run;
  }

  private async fetchCompleteSnapshot(
    account: CarrierAccount,
    signal?: AbortSignal,
  ): Promise<Map<string, InventoryNumber>> {
    const inventory = this.carriers.inventory(account);
    const result = new Map<string, InventoryNumber>();
    const tokens = new Set<string>();
    let pageToken: string | undefined;
    let expectedCount: number | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      if (signal?.aborted)
        throw new Error("Inventory synchronization interrupted");
      const batch = await inventory.listInventory(account, {
        pageSize: 100,
        pageToken,
      });
      if (signal?.aborted)
        throw new Error("Inventory synchronization interrupted");
      if (batch.totalCount !== undefined) {
        if (expectedCount !== undefined && expectedCount !== batch.totalCount)
          throw new CarrierError(
            "invalid_response",
            account.carrier,
            "Inventory count changed during pagination",
          );
        expectedCount = batch.totalCount;
      }
      if (batch.nextPageToken && batch.numbers.length === 0)
        throw new CarrierError(
          "invalid_response",
          account.carrier,
          "Empty inventory page with continuation",
        );
      for (const number of batch.numbers) {
        const e164 = normalizeE164(number.e164);
        const existing = result.get(e164);
        if (existing && existing.nativeId !== number.nativeId)
          throw new CarrierError(
            "invalid_response",
            account.carrier,
            "Carrier returned duplicate number identity",
          );
        result.set(e164, { ...number, e164 });
        if (result.size > MAX_NUMBERS)
          throw new CarrierError(
            "invalid_response",
            account.carrier,
            "Carrier inventory exceeds sync limit",
          );
      }
      if (!batch.nextPageToken) {
        if (expectedCount !== undefined && expectedCount !== result.size)
          throw new CarrierError(
            "invalid_response",
            account.carrier,
            "Carrier inventory is incomplete",
          );
        return result;
      }
      if (tokens.has(batch.nextPageToken))
        throw new CarrierError(
          "invalid_response",
          account.carrier,
          "Carrier pagination loop",
        );
      tokens.add(batch.nextPageToken);
      pageToken = batch.nextPageToken;
    }
    throw new CarrierError(
      "invalid_response",
      account.carrier,
      "Carrier pagination limit reached",
    );
  }

  private async upsertNumber(
    account: CarrierAccountRecord,
    number: InventoryNumber,
  ): Promise<"created" | "updated" | "issues"> {
    const db = this.database.sql();
    const now = new Date();
    const existing = await db
      .table<PhoneNumberRecord>("phone_numbers")
      .findOne({ e164: number.e164 });
    if (existing && existing.carrierAccountId !== account.id) {
      await this.recordIssue(
        account.id,
        number.e164,
        "duplicate_carrier",
        existing.id,
      );
      return "issues";
    }
    if (existing?.status === "disconnected") {
      await this.recordIssue(
        account.id,
        number.e164,
        "unexpected_reappearance",
        existing.id,
      );
      return "issues";
    }
    if (existing && existing.carrierNumberId !== number.nativeId) {
      await this.recordIssue(
        account.id,
        number.e164,
        "duplicate_carrier",
        existing.id,
      );
      return "issues";
    }
    await this.database.withTransaction(async (tx, session) => {
      const numbers = tx.table<PhoneNumberRecord>("phone_numbers");
      if (existing) {
        await numbers.updateOne(
          { id: existing.id },
          { $set: { status: "active", lastSeenAt: now, updatedAt: now } },
          { session },
        );
        if (existing.status === "missing")
          await tx.table<HoldingRecord>("number_holdings").insertOne(
            {
              id: uuid(),
              phoneNumberId: existing.id,
              carrierAccountId: account.id,
              status: "active",
              startedAt: now,
              createdAt: now,
            },
            { session },
          );
      } else {
        const created: PhoneNumberRecord = {
          id: uuid(),
          e164: number.e164,
          carrierId: account.carrierId,
          carrierAccountId: account.id,
          carrierNumberId: number.nativeId,
          status: "active",
          firstSeenAt: now,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        };
        await numbers.insertOne(created, { session });
        await tx.table<HoldingRecord>("number_holdings").insertOne(
          {
            id: uuid(),
            phoneNumberId: created.id,
            carrierAccountId: account.id,
            status: "active",
            startedAt: now,
            createdAt: now,
          },
          { session },
        );
      }
    });
    await db
      .table<ReconciliationIssueRecord>("reconciliation_issues")
      .updateMany(
        {
          carrierAccountId: account.id,
          e164: number.e164,
          status: "open",
          type: "missing_at_carrier",
        },
        { $set: { status: "resolved", resolvedAt: now } },
      );
    return existing ? "updated" : "created";
  }

  private async markMissing(number: PhoneNumberRecord): Promise<boolean> {
    const now = new Date();
    const changed = await this.database.withTransaction(async (db, session) => {
      const update = await db
        .table<PhoneNumberRecord>("phone_numbers")
        .updateOne(
          { id: number.id, status: "active" },
          { $set: { status: "missing", updatedAt: now } },
          { session },
        );
      if (!update.matchedCount) return false;
      await db
        .table<HoldingRecord>("number_holdings")
        .updateOne(
          { phoneNumberId: number.id, status: "active" },
          { $set: { status: "closed", endedAt: now } },
          { session },
        );
      return true;
    });
    if (changed)
      await this.recordIssue(
        number.carrierAccountId,
        number.e164,
        "missing_at_carrier",
        number.id,
      );
    return changed;
  }

  private async recordIssue(
    accountId: Id,
    e164: string,
    type: ReconciliationIssueRecord["type"],
    phoneNumberId?: Id,
  ) {
    const issues = this.database
      .sql()
      .table<ReconciliationIssueRecord>("reconciliation_issues");
    try {
      await issues.updateOne(
        { carrierAccountId: accountId, e164, type, status: "open" },
        {
          $setOnInsert: {
            id: uuid(),
            phoneNumberId,
            detectedAt: new Date(),
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if (!(error instanceof DatabaseError && error.code === "23505"))
        throw error;
    }
  }
}
