import type {
  CarrierAccount,
  CarrierAdapter,
  CarrierCapability,
  InventoryPage,
  AvailableNumber,
  NumberSearchRequest,
} from "./domain";
import {
  EnvironmentCarrierCredentialStore,
  basicAuth,
  type CarrierCredentialStore,
} from "./credentials";
import { CarrierError } from "./errors";
import { FetchCarrierTransport, type CarrierTransport } from "./transport";
import { normalizeCarrierNumber, object, priceCents } from "./provider-values";
export class BulkVsRestAdapter implements CarrierAdapter {
  readonly code = "bulkvs";
  readonly capabilities = new Set<CarrierCapability>([
    "inventory.list",
    "number.search",
  ]);
  readonly inventory = { listInventory: this.listInventory.bind(this) };
  readonly numberSearch = { searchNumbers: this.searchNumbers.bind(this) };
  constructor(
    private readonly credentials: CarrierCredentialStore = new EnvironmentCarrierCredentialStore(),
    private readonly transport: CarrierTransport = new FetchCarrierTransport(
      30000,
    ),
  ) {}
  private async get(
    account: CarrierAccount,
    path: string,
    parameters: Record<string, string> = {},
    inventory = false,
  ) {
    if (account.carrier !== this.code)
      throw new CarrierError(
        "configuration",
        this.code,
        "Invalid BulkVS account",
      );
    const url = new URL(`/api/v1.0/${path}`, "https://portal.bulkvs.com");
    for (const [key, value] of Object.entries(parameters))
      url.searchParams.set(key, value);
    return this.transport.getJson(
      url,
      basicAuth(this.credentials.get(account)),
      this.code,
      inventory ? 32000000 : 1000000,
      !inventory,
    );
  }
  async listInventory(account: CarrierAccount): Promise<InventoryPage> {
    // The documented endpoint returns all account entries when Number and Limit are omitted.
    const raw = await this.get(account, "tnRecord", {}, true);
    if (!Array.isArray(raw))
      throw new CarrierError(
        "invalid_response",
        this.code,
        "Invalid BulkVS inventory",
      );
    const numbers = raw.map((value) => {
      const row = object(value);
      return {
        e164: normalizeCarrierNumber(row.TN, this.code),
        nativeId: String(row.TN),
        status: "active" as const,
      };
    });
    return { numbers, totalCount: numbers.length };
  }
  async searchNumbers(account: CarrierAccount, request: NumberSearchRequest) {
    if (!request.areaCode || request.city || request.region || request.pattern)
      throw new CarrierError(
        "unsupported",
        this.code,
        "BulkVS supports area-code searches",
      );
    const rawExchanges = await this.get(account, "exchanges", {
      Search: request.areaCode,
      Limit: "1000",
    });
    if (Array.isArray(rawExchanges) && rawExchanges.length === 0)
      return { numbers: [], partial: false };
    const exchanges = object(rawExchanges);
    if (
      !Array.isArray(exchanges.Data) ||
      !Number.isFinite(Number(exchanges.Total))
    )
      throw new CarrierError(
        "invalid_response",
        this.code,
        "Invalid BulkVS exchanges",
      );
    const prefixes = exchanges.Data.map(object)
      .filter(
        (row) =>
          row.Type === "NPANXX" &&
          /^\d{6}$/.test(String(row.Prefix)) &&
          String(row.Prefix).startsWith(request.areaCode!) &&
          Number(row.Quantity) > 0,
      )
      .map((row) => String(row.Prefix));
    const offers: AvailableNumber[] = [];
    const seen = new Set<string>();
    let visited = 0;
    for (const prefix of prefixes.slice(0, 10)) {
      visited++;
      const raw = await this.get(account, "orderTn", {
        Npa: prefix.slice(0, 3),
        Nxx: prefix.slice(3),
        Lca: "false",
        Limit: String(request.quantity - offers.length),
      });
      if (!Array.isArray(raw))
        throw new CarrierError(
          "invalid_response",
          this.code,
          "Invalid BulkVS search",
        );
      for (const value of raw) {
        const row = object(value);
        const e164 = normalizeCarrierNumber(row.TN, this.code);
        if (seen.has(e164)) continue;
        seen.add(e164);
        offers.push({
          e164,
          nativeId: String(row.TN),
          locality:
            typeof row["Rate Center"] === "string"
              ? row["Rate Center"]
              : undefined,
          region: typeof row.State === "string" ? row.State : undefined,
          monthlyPriceCents: priceCents(row.Mrc),
          setupPriceCents: priceCents(row.Nrc),
          currency:
            row.Mrc !== undefined || row.Nrc !== undefined ? "USD" : undefined,
        });
        if (offers.length >= request.quantity) break;
      }
      if (offers.length >= request.quantity) break;
    }
    return {
      numbers: offers,
      partial:
        offers.length < request.quantity &&
        (visited < prefixes.length ||
          Number(exchanges.Total) > exchanges.Data.length),
    };
  }
}
