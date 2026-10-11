import { normalizeE164 } from "../database/phone-number";
import type {
  CarrierAccount,
  CarrierAdapter,
  CarrierCapability,
  CarrierCode,
  InventoryPage,
  InventoryRequest,
} from "./domain";
import type { CarrierCredentialStore } from "./credentials";
import { CarrierError } from "./errors";
import type { CarrierTransport } from "./transport";

class ContractPendingAdapter implements CarrierAdapter {
  readonly capabilities = new Set<CarrierCapability>();
  constructor(readonly code: CarrierCode) {}
}

export class PeerlessSoapAdapter extends ContractPendingAdapter {
  constructor() {
    super("peerless");
  }
}

export class BulkVsSoapAdapter extends ContractPendingAdapter {
  constructor() {
    super("bulkvs");
  }
}

export class BandwidthAdapter implements CarrierAdapter {
  readonly code = "bandwidth";
  readonly capabilities = new Set<CarrierCapability>(["inventory.list"]);
  readonly inventory = { listInventory: this.listInventory.bind(this) };

  constructor(
    private readonly credentials: CarrierCredentialStore,
    private readonly transport: CarrierTransport,
  ) {}

  async listInventory(
    account: CarrierAccount,
    request: InventoryRequest,
  ): Promise<InventoryPage> {
    if (
      account.carrier !== this.code ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(account.nativeAccountId)
    ) {
      throw new CarrierError(
        "configuration",
        this.code,
        "Invalid Bandwidth account",
      );
    }
    const size = request.pageSize ?? 100;
    if (!Number.isInteger(size) || size < 1 || size > 100)
      throw new CarrierError(
        "invalid_request",
        this.code,
        "Invalid inventory page size",
      );
    if (request.pageToken && !/^\+?[0-9]{1,16}$/.test(request.pageToken))
      throw new CarrierError(
        "invalid_request",
        this.code,
        "Invalid inventory page token",
      );
    const path = `/api/v2/accounts/${encodeURIComponent(account.nativeAccountId)}/inserviceNumbers`;
    const url = new URL(path, "https://api.bandwidth.com");
    url.searchParams.set("size", String(size));
    if (request.pageToken) url.searchParams.set("page", request.pageToken);
    const { username, password } = this.credentials.get(account);
    const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    const raw = await this.transport.getJson(url, authorization, this.code);
    return normalizeBandwidthInventory(raw, path);
  }
}

export function normalizeBandwidthInventory(
  raw: unknown,
  path: string,
): InventoryPage {
  if (!raw || typeof raw !== "object")
    throw new CarrierError(
      "invalid_response",
      "bandwidth",
      "Invalid inventory response",
    );
  const value = raw as Record<string, unknown>;
  if (
    !Array.isArray(value.phoneNumbers) ||
    !value.phoneNumbers.every((n) => typeof n === "string")
  )
    throw new CarrierError(
      "invalid_response",
      "bandwidth",
      "Invalid inventory numbers",
    );
  let nextPageToken: string | undefined;
  if (value.links !== undefined) {
    if (!value.links || typeof value.links !== "object")
      throw new CarrierError(
        "invalid_response",
        "bandwidth",
        "Invalid inventory links",
      );
    const next = (value.links as Record<string, unknown>).next;
    if (next !== undefined) {
      if (typeof next !== "string")
        throw new CarrierError(
          "invalid_response",
          "bandwidth",
          "Invalid next page",
        );
      let url: URL;
      try {
        url = new URL(next);
      } catch {
        throw new CarrierError(
          "invalid_response",
          "bandwidth",
          "Invalid next page URL",
        );
      }
      if (url.origin !== "https://api.bandwidth.com" || url.pathname !== path)
        throw new CarrierError(
          "invalid_response",
          "bandwidth",
          "Invalid next page origin",
        );
      nextPageToken = url.searchParams.get("page") ?? undefined;
      if (!nextPageToken || !/^\+?[0-9]{1,16}$/.test(nextPageToken))
        throw new CarrierError(
          "invalid_response",
          "bandwidth",
          "Invalid next page token",
        );
    }
  }
  const totalCount = value.totalCount;
  if (
    totalCount !== undefined &&
    (!Number.isSafeInteger(totalCount) || (totalCount as number) < 0)
  )
    throw new CarrierError(
      "invalid_response",
      "bandwidth",
      "Invalid inventory count",
    );
  let numbers: InventoryPage["numbers"];
  try {
    numbers = value.phoneNumbers.map((number: string) => ({
      e164: normalizeE164(number),
      nativeId: number,
      status: "active" as const,
    }));
  } catch {
    throw new CarrierError(
      "invalid_response",
      "bandwidth",
      "Invalid inventory phone number",
    );
  }
  return {
    numbers,
    nextPageToken,
    totalCount: totalCount as number | undefined,
  };
}
