import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MongoServerError, ObjectId } from "mongodb";
import { CarrierRegistryService } from "../carriers/registry";
import type {
  CarrierAccount,
  CarrierCode,
  InventoryNumber,
} from "../carriers/domain";
import { CarrierError } from "../carriers/errors";
import { DatabaseService } from "../database/database.service";
import { normalizeE164 } from "../database/phone-number";
import type { Filter } from "mongodb";
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
    const db = this.database.nativeDb();
    const carriers = await db
      .collection<CarrierRecord>("carriers")
      .find()
      .sort({ code: 1 })
      .toArray();
    const accounts = await db
      .collection<CarrierAccountRecord>("carrier_accounts")
      .find()
      .toArray();
    const latestRuns = await Promise.all(
      accounts.map((account) =>
        db
          .collection<SyncRunRecord>("carrier_sync_runs")
          .findOne(
            { carrierAccountId: account._id },
            { sort: { startedAt: -1 } },
          ),
      ),
    );
    const runMap = new Map(
      accounts.map((account, index) => [
        account._id.toHexString(),
        latestRuns[index],
      ]),
    );
    return carriers.map((carrier) => ({
      id: carrier._id.toHexString(),
      code: carrier.code,
      displayName: carrier.displayName,
      capabilities: this.carriers.capabilities(carrier.code),
      accounts: accounts
        .filter((account) => account.carrierId.equals(carrier._id))
        .map((account) => ({
          id: account._id.toHexString(),
          externalAccountId: account.externalAccountId,
          status: account.status,
          lastSyncedAt: account.lastSyncedAt,
          lastSync: runMap.get(account._id.toHexString()) && {
            status: runMap.get(account._id.toHexString())!.status,
            startedAt: runMap.get(account._id.toHexString())!.startedAt,
            finishedAt: runMap.get(account._id.toHexString())!.finishedAt,
            seen: runMap.get(account._id.toHexString())!.seen,
            issues: runMap.get(account._id.toHexString())!.issues,
            errorCode: runMap.get(account._id.toHexString())!.errorCode,
          },
        })),
    }));
  }

  async configureAccount(
    carrierId: ObjectId,
    externalAccountId: string,
    credentialRef?: string,
  ) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(externalAccountId))
      throw new BadRequestException("Invalid carrier account ID");
    if (credentialRef && !/^[A-Z][A-Z0-9_]{1,63}$/.test(credentialRef))
      throw new BadRequestException("Invalid credential reference");
    await this.database.ensureReady();
    const db = this.database.nativeDb();
    const carrier = await db
      .collection<CarrierRecord>("carriers")
      .findOne({ _id: carrierId });
    if (!carrier) throw new NotFoundException("Carrier not found");
    const now = new Date();
    try {
      const result = await db
        .collection<CarrierAccountRecord>("carrier_accounts")
        .findOneAndUpdate(
          { carrierId, externalAccountId },
          {
            $set: { credentialRef, updatedAt: now },
            $setOnInsert: { status: "active", createdAt: now },
          },
          { upsert: true, returnDocument: "after" },
        );
      return {
        id: result!._id.toHexString(),
        carrier: carrier.code,
        externalAccountId,
        status: result!.status,
      };
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000)
        throw new ConflictException("Carrier account already exists");
      throw error;
    }
  }

  async listNumbers(input: {
    search?: string;
    customer?: string;
    carrier?: CarrierCode;
    status?: "active" | "missing";
    page?: number;
    pageSize?: number;
    sort?: "e164" | "updatedAt" | "status";
    direction?: "asc" | "desc";
  }) {
    await this.database.ensureReady();
    const db = this.database.nativeDb();
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
        .collection<CarrierRecord>("carriers")
        .findOne({ code: input.carrier });
      if (!carrier) return { items: [], total: 0, page, pageSize };
      filter.carrierId = carrier._id;
    }
    if (input.customer) {
      const name = input.customer.trim();
      if (name.length < 2 || name.length > 100)
        throw new BadRequestException("Invalid customer search");
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const customers = await db
        .collection("customers")
        .find(
          { name: { $regex: escaped, $options: "i" } },
          { projection: { _id: 1 } },
        )
        .limit(1_001)
        .toArray();
      if (customers.length > 1_000)
        throw new BadRequestException("Customer search is too broad");
      const assignments = await db
        .collection("number_assignments")
        .find(
          {
            customerId: { $in: customers.map((item) => item._id) },
            active: true,
          },
          { projection: { phoneNumberId: 1 } },
        )
        .limit(100_001)
        .toArray();
      if (assignments.length > 100_000)
        throw new BadRequestException("Customer search is too broad");
      filter._id = {
        $in: assignments.map((item) => item.phoneNumberId as ObjectId),
      };
    }
    const sort = input.sort ?? "e164";
    const direction = input.direction === "desc" ? -1 : 1;
    const collection = db.collection<PhoneNumberRecord>("phone_numbers");
    const [total, numbers] = await Promise.all([
      collection.countDocuments(filter),
      collection
        .find(filter)
        .sort({ [sort]: direction, _id: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
    ]);
    const accounts = await db
      .collection<CarrierAccountRecord>("carrier_accounts")
      .find({ _id: { $in: numbers.map((number) => number.carrierAccountId) } })
      .toArray();
    const accountMap = new Map(
      accounts.map((account) => [account._id.toHexString(), account]),
    );
    const carriers = await db
      .collection<CarrierRecord>("carriers")
      .find({ _id: { $in: numbers.map((number) => number.carrierId) } })
      .toArray();
    const carrierMap = new Map(
      carriers.map((carrier) => [carrier._id.toHexString(), carrier]),
    );
    const assignments = await db
      .collection("number_assignments")
      .find({
        phoneNumberId: { $in: numbers.map((number) => number._id) },
        active: true,
      })
      .toArray();
    const customerIds = assignments.map(
      (assignment) => assignment.customerId as ObjectId,
    );
    const customers = await db
      .collection("customers")
      .find({ _id: { $in: customerIds } })
      .toArray();
    const customerMap = new Map(
      customers.map((customer) => [customer._id.toHexString(), customer]),
    );
    return {
      items: numbers.map((number) => {
        const assignment = assignments.find((item) =>
          (item.phoneNumberId as ObjectId).equals(number._id),
        );
        const customer =
          assignment &&
          customerMap.get((assignment.customerId as ObjectId).toHexString());
        return {
          id: number._id.toHexString(),
          e164: number.e164,
          status: number.status,
          carrier: carrierMap.get(number.carrierId.toHexString())?.code,
          carrierAccount: accountMap.get(number.carrierAccountId.toHexString())
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

  async getNumber(id: ObjectId) {
    await this.database.ensureReady();
    const db = this.database.nativeDb();
    const number = await db
      .collection<PhoneNumberRecord>("phone_numbers")
      .findOne({ _id: id });
    if (!number) throw new NotFoundException("Number not found");
    const [carrier, account, holdings, assignments] = await Promise.all([
      db
        .collection<CarrierRecord>("carriers")
        .findOne({ _id: number.carrierId }),
      db
        .collection<CarrierAccountRecord>("carrier_accounts")
        .findOne({ _id: number.carrierAccountId }),
      db
        .collection<HoldingRecord>("number_holdings")
        .find({ phoneNumberId: id })
        .sort({ startedAt: -1 })
        .toArray(),
      db
        .collection("number_assignments")
        .find({ phoneNumberId: id })
        .sort({ createdAt: -1 })
        .toArray(),
    ]);
    return {
      id: number._id.toHexString(),
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
        customerId: (assignment.customerId as ObjectId).toHexString(),
        active: assignment.active as boolean,
        startedAt: assignment.startedAt as Date | undefined,
        endedAt: assignment.endedAt as Date | undefined,
      })),
    };
  }

  async listIssues(status?: "open" | "resolved") {
    await this.database.ensureReady();
    const issues = await this.database
      .nativeDb()
      .collection<ReconciliationIssueRecord>("reconciliation_issues")
      .find(status ? { status } : {})
      .sort({ detectedAt: -1 })
      .limit(200)
      .toArray();
    return issues.map((issue) => ({
      id: issue._id.toHexString(),
      e164: issue.e164,
      type: issue.type,
      status: issue.status,
      detectedAt: issue.detectedAt,
      resolvedAt: issue.resolvedAt,
      carrierAccountId: issue.carrierAccountId.toHexString(),
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

  async sync(
    accountId: ObjectId,
    signal?: AbortSignal,
  ): Promise<SyncRunRecord> {
    await this.database.ensureReady();
    const db = this.database.nativeDb();
    const accounts = db.collection<CarrierAccountRecord>("carrier_accounts");
    const token = randomUUID();
    const now = new Date();
    const account = await accounts.findOneAndUpdate(
      {
        _id: accountId,
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
      if (!(await accounts.findOne({ _id: accountId })))
        throw new NotFoundException("Carrier account not found");
      throw new ConflictException(
        "Carrier account is already syncing or disabled",
      );
    }
    const carrier = await db
      .collection<CarrierRecord>("carriers")
      .findOne({ _id: account.carrierId });
    if (!carrier) throw new NotFoundException("Carrier not found");
    const run: SyncRunRecord = {
      _id: new ObjectId(),
      carrierAccountId: accountId,
      status: "running",
      startedAt: now,
      seen: 0,
      created: 0,
      updated: 0,
      missing: 0,
      issues: 0,
    };
    await db.collection<SyncRunRecord>("carrier_sync_runs").insertOne(run);
    try {
      const snapshot = await this.fetchCompleteSnapshot(
        {
          id: accountId.toHexString(),
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
        .collection<PhoneNumberRecord>("phone_numbers")
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
        { _id: accountId, syncLeaseToken: token },
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
        .collection<SyncRunRecord>("carrier_sync_runs")
        .replaceOne({ _id: run._id }, run);
      await accounts.updateOne(
        { _id: accountId, syncLeaseToken: token },
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
    for (let page = 0; page < MAX_PAGES; page += 1) {
      if (signal?.aborted)
        throw new Error("Inventory synchronization interrupted");
      const batch = await inventory.listInventory(account, {
        pageSize: 100,
        pageToken,
      });
      if (signal?.aborted)
        throw new Error("Inventory synchronization interrupted");
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
      if (!batch.nextPageToken) return result;
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
    const db = this.database.nativeDb();
    const now = new Date();
    const existing = await db
      .collection<PhoneNumberRecord>("phone_numbers")
      .findOne({ e164: number.e164 });
    if (existing && !existing.carrierAccountId.equals(account._id)) {
      await this.recordIssue(
        account._id,
        number.e164,
        "duplicate_carrier",
        existing._id,
      );
      return "issues";
    }
    if (existing && existing.carrierNumberId !== number.nativeId) {
      await this.recordIssue(
        account._id,
        number.e164,
        "duplicate_carrier",
        existing._id,
      );
      return "issues";
    }
    await this.database.withTransaction(async (tx, session) => {
      const numbers = tx.collection<PhoneNumberRecord>("phone_numbers");
      if (existing) {
        await numbers.updateOne(
          { _id: existing._id },
          { $set: { status: "active", lastSeenAt: now, updatedAt: now } },
          { session },
        );
        if (existing.status === "missing")
          await tx.collection<HoldingRecord>("number_holdings").insertOne(
            {
              _id: new ObjectId(),
              phoneNumberId: existing._id,
              carrierAccountId: account._id,
              status: "active",
              startedAt: now,
              createdAt: now,
            },
            { session },
          );
      } else {
        const created: PhoneNumberRecord = {
          _id: new ObjectId(),
          e164: number.e164,
          carrierId: account.carrierId,
          carrierAccountId: account._id,
          carrierNumberId: number.nativeId,
          status: "active",
          firstSeenAt: now,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        };
        await numbers.insertOne(created, { session });
        await tx.collection<HoldingRecord>("number_holdings").insertOne(
          {
            _id: new ObjectId(),
            phoneNumberId: created._id,
            carrierAccountId: account._id,
            status: "active",
            startedAt: now,
            createdAt: now,
          },
          { session },
        );
      }
    });
    await db
      .collection<ReconciliationIssueRecord>("reconciliation_issues")
      .updateMany(
        {
          carrierAccountId: account._id,
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
        .collection<PhoneNumberRecord>("phone_numbers")
        .updateOne(
          { _id: number._id, status: "active" },
          { $set: { status: "missing", updatedAt: now } },
          { session },
        );
      if (!update.matchedCount) return false;
      await db
        .collection<HoldingRecord>("number_holdings")
        .updateOne(
          { phoneNumberId: number._id, status: "active" },
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
        number._id,
      );
    return changed;
  }

  private async recordIssue(
    accountId: ObjectId,
    e164: string,
    type: ReconciliationIssueRecord["type"],
    phoneNumberId?: ObjectId,
  ) {
    const issues = this.database
      .nativeDb()
      .collection<ReconciliationIssueRecord>("reconciliation_issues");
    try {
      await issues.updateOne(
        { carrierAccountId: accountId, e164, type, status: "open" },
        {
          $setOnInsert: {
            _id: new ObjectId(),
            phoneNumberId,
            detectedAt: new Date(),
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if (!(error instanceof MongoServerError && error.code === 11000))
        throw error;
    }
  }
}
