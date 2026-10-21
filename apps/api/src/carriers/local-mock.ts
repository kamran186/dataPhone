import { createHash } from "node:crypto";
import { uuid } from "../database/query";
import type { DatabaseService } from "../database/database.service";
import { normalizeE164 } from "../database/phone-number";
import type {
  CarrierAccount,
  CarrierCapability,
  CarrierOrder,
  InventoryPage,
  InventoryRequest,
} from "./domain";
import { MockCarrierAdapter } from "./mock";

export function localMockEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.DATAPHONE_ENABLE_MOCK_CARRIER === "true"
  );
}

/** Explicit local sandbox. No external carrier calls or billing. */
export class LocalMockAdapter extends MockCarrierAdapter {
  override readonly capabilities = new Set<CarrierCapability>([
    "inventory.list",
    "number.search",
    "number.purchase",
    "number.disconnect",
    "number.portability",
    "port.submit",
    "order.status",
  ]);
  readonly numberSearch = { searchNumbers: this.searchNumbers.bind(this) };
  readonly purchase = { purchaseNumbers: this.purchaseNumbers.bind(this) };
  readonly disconnect = { disconnectNumber: this.disconnectNumber.bind(this) };
  readonly portability = { checkPortability: this.checkPortability.bind(this) };
  readonly portSubmission = { submitPort: this.submitPort.bind(this) };
  readonly orderStatus = { getOrderStatus: this.getOrderStatus.bind(this) };
  constructor(private readonly database: DatabaseService) {
    super();
  }
  override async listInventory(
    account: CarrierAccount,
    request: InventoryRequest,
  ): Promise<InventoryPage> {
    this.check(account);
    await this.database.ensureReady();
    const pageSize = request.pageSize ?? 100,
      offset = Number(request.pageToken ?? "0");
    if (
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      !Number.isInteger(offset) ||
      offset < 0
    )
      throw new Error("Invalid mock inventory page");
    const collection = this.database
      .sql()
      .table<{ e164: string }>("phone_numbers");
    const filter = {
      carrierAccountId: uuid(account.id),
      status: "active",
    };
    const [totalCount, rows] = await Promise.all([
      collection.count(filter),
      collection
        .find(filter)
        .sort({ e164: 1 })
        .skip(offset)
        .limit(pageSize)
        .toArray(),
    ]);
    return {
      numbers: rows.map((row) => ({
        e164: row.e164,
        nativeId: row.e164,
        status: "active",
      })),
      totalCount,
      nextPageToken:
        offset + pageSize < totalCount ? String(offset + pageSize) : undefined,
    };
  }
  private check(account: CarrierAccount) {
    if (account.carrier !== "mock") throw new Error("Wrong mock account");
  }
  async searchNumbers(
    account: CarrierAccount,
    request: {
      areaCode?: string;
      city?: string;
      region?: string;
      pattern?: string;
      quantity: number;
    },
  ) {
    this.check(account);
    const area =
      request.areaCode && /^\d{3}$/.test(request.areaCode)
        ? request.areaCode
        : "804";
    const pattern = request.pattern?.replace(/\D/g, "") ?? "";
    const candidates = Array.from(
      { length: 1000 },
      (_, index) => `+1${area}5550${String(index).padStart(3, "0")}`,
    );
    await this.database.ensureReady();
    const existing = await this.database
      .sql()
      .table("phone_numbers")
      .find(
        { e164: { $in: candidates }, status: "active" },
        { projection: { e164: 1 } },
      )
      .toArray();
    const taken = new Set(existing.map((row) => row.e164));
    return candidates
      .filter(
        (value) => !taken.has(value) && (!pattern || value.includes(pattern)),
      )
      .slice(0, request.quantity)
      .map((e164) => ({
        e164,
        nativeId: e164,
        locality: request.city || "Mock City",
        region: request.region || "VA",
        monthlyPriceCents: 100,
        setupPriceCents: 0,
        currency: "USD",
      }));
  }
  async purchaseNumbers(
    account: CarrierAccount,
    request: { nativeIds: string[]; idempotencyKey: string },
  ): Promise<CarrierOrder> {
    this.check(account);
    const numbers = request.nativeIds.map(normalizeE164);
    return {
      nativeOrderId: `mock-purchase-${createHash("sha256").update(request.idempotencyKey).digest("hex").slice(0, 20)}`,
      status: "complete",
      numbers,
    };
  }
  async disconnectNumber(
    account: CarrierAccount,
    request: { e164: string; idempotencyKey: string },
  ): Promise<CarrierOrder> {
    this.check(account);
    return {
      nativeOrderId: `mock-disconnect-${createHash("sha256").update(request.idempotencyKey).digest("hex").slice(0, 20)}`,
      status: "complete",
      numbers: [normalizeE164(request.e164)],
    };
  }
  async checkPortability(account: CarrierAccount, e164: string) {
    this.check(account);
    normalizeE164(e164);
    return { portable: true };
  }
  async submitPort(
    account: CarrierAccount,
    request: { reference: string; numbers: string[]; documentIds: string[] },
  ): Promise<CarrierOrder> {
    this.check(account);
    const numbers = request.numbers.map(normalizeE164);
    const date = new Date(Date.now() + 24 * 60 * 60_000)
      .toISOString()
      .slice(0, 10);
    return {
      nativeOrderId: `mock-port-${Buffer.from(JSON.stringify(numbers)).toString("base64url")}`,
      status: "pending",
      numbers: [],
      nativeStatus: "FOC_CONFIRMED",
      focDate: date,
    };
  }
  async getOrderStatus(
    account: CarrierAccount,
    nativeOrderId: string,
  ): Promise<CarrierOrder> {
    this.check(account);
    if (!nativeOrderId.startsWith("mock-port-"))
      throw new Error("Unknown mock order");
    const numbers = JSON.parse(
      Buffer.from(
        nativeOrderId.slice("mock-port-".length),
        "base64url",
      ).toString("utf8"),
    ) as string[];
    if (
      !Array.isArray(numbers) ||
      numbers.some((value) => typeof value !== "string")
    )
      throw new Error("Invalid mock order");
    return {
      nativeOrderId,
      status: "complete",
      numbers: numbers.map(normalizeE164),
      nativeStatus: "COMPLETED",
    };
  }
}
