import { normalizeE164 } from "../database/phone-number";
import type {
  CarrierAccount,
  CarrierAdapter,
  CarrierCapability,
  InventoryPage,
  InventoryRequest,
} from "./domain";
import { CarrierError } from "./errors";

/** Deterministic test fixture. Never register this adapter in production. */
export class MockCarrierAdapter implements CarrierAdapter {
  readonly code = "mock";
  readonly capabilities = new Set<CarrierCapability>(["inventory.list"]);
  readonly inventory = { listInventory: this.listInventory.bind(this) };
  private readonly numbers: string[];

  constructor(numbers: string[] = []) {
    this.numbers = numbers.map(normalizeE164);
  }

  async listInventory(
    account: CarrierAccount,
    request: InventoryRequest,
  ): Promise<InventoryPage> {
    if (account.carrier !== "mock")
      throw new CarrierError("configuration", "mock", "Wrong mock account");
    const size = request.pageSize ?? 100;
    const offset = Number(request.pageToken ?? "0");
    if (
      !Number.isInteger(size) ||
      size < 1 ||
      size > 100 ||
      !Number.isInteger(offset) ||
      offset < 0
    )
      throw new CarrierError("invalid_request", "mock", "Invalid mock page");
    const numbers = this.numbers.slice(offset, offset + size).map((e164) => ({
      e164,
      nativeId: e164,
      status: "active" as const,
    }));
    const next = offset + size;
    return {
      numbers,
      nextPageToken: next < this.numbers.length ? String(next) : undefined,
      totalCount: this.numbers.length,
    };
  }
}
