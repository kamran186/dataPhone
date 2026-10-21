import "reflect-metadata";
import {
  BandwidthAdapter,
  BulkVsRestAdapter,
  PeerlessSoapAdapter,
  normalizeBandwidthInventory,
} from "../src/carriers/adapters";
import { EnvironmentCarrierCredentialStore } from "../src/carriers/credentials";
import type { CarrierAccount } from "../src/carriers/domain";
import { CarrierError, mapHttpError } from "../src/carriers/errors";
import { MockCarrierAdapter } from "../src/carriers/mock";
import { CarrierRegistry } from "../src/carriers/registry";
import { FetchCarrierTransport } from "../src/carriers/transport";

const account: CarrierAccount = {
  id: "local-1",
  carrier: "bandwidth",
  nativeAccountId: "12345",
  credentialRef: "BANDWIDTH_MAIN",
};

const credentials = new EnvironmentCarrierCredentialStore({
  DATAPHONE_CARRIER_BANDWIDTH_MAIN_USERNAME: "api-user",
  DATAPHONE_CARRIER_BANDWIDTH_MAIN_PASSWORD: "api-secret",
});

function registry(fetcher: typeof fetch) {
  return new CarrierRegistry([
    new PeerlessSoapAdapter(),
    new BulkVsRestAdapter(),
    new BandwidthAdapter(credentials, new FetchCarrierTransport(100, fetcher)),
    new MockCarrierAdapter(["+18043024183", "+18042121778"]),
  ]);
}

describe("carrier adapter contract", () => {
  it("resolves capabilities and rejects unsupported operations", () => {
    const carriers = registry(async () => new Response());
    expect(carriers.capabilities("bandwidth")).toEqual([
      "inventory.list",
      "number.search",
    ]);
    expect(carriers.capabilities("peerless")).toEqual([
      "inventory.list",
      "number.search",
    ]);
    expect(carriers.capabilities("bulkvs")).toEqual([
      "inventory.list",
      "number.search",
    ]);
    expect(() => carriers.resolve(account, "number.purchase")).toThrow(
      CarrierError,
    );
    expect(() =>
      carriers.resolve({ ...account, carrier: "peerless" }, "number.purchase"),
    ).toThrow("does not support");
  });

  it("normalizes the documented Bandwidth inventory request and response", async () => {
    const fetcher = (async (url: URL | RequestInfo, init?: RequestInit) => {
      const request = new URL(String(url));
      expect(request.origin).toBe("https://api.bandwidth.com");
      expect(request.pathname).toBe("/api/v2/accounts/12345/inserviceNumbers");
      expect(request.searchParams.get("page")).toBe("+18043814905");
      expect(request.searchParams.get("size")).toBe("2");
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        `Basic ${Buffer.from("api-user:api-secret").toString("base64")}`,
      );
      return Response.json({
        totalCount: 59,
        links: {
          next: "https://api.bandwidth.com/api/v2/accounts/12345/inserviceNumbers?page=%2B18043814906&size=2",
        },
        phoneNumbers: ["+18043024183", "+18042121778"],
      });
    }) as typeof fetch;
    const page = await registry(fetcher)
      .inventory(account)
      .listInventory(account, {
        pageSize: 2,
        pageToken: "+18043814905",
      });
    expect(page).toEqual({
      totalCount: 59,
      nextPageToken: "+18043814906",
      numbers: [
        { e164: "+18043024183", nativeId: "+18043024183", status: "active" },
        { e164: "+18042121778", nativeId: "+18042121778", status: "active" },
      ],
    });
  });

  it("rejects bad requests before credentials or network access", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return Response.json({ phoneNumbers: [] });
    }) as typeof fetch;
    const inventory = registry(fetcher).inventory(account);
    await expect(
      inventory.listInventory(account, { pageSize: 101 }),
    ).rejects.toMatchObject({
      kind: "invalid_request",
    });
    await expect(
      inventory.listInventory(account, { pageToken: "https://evil.example/" }),
    ).rejects.toMatchObject({ kind: "invalid_request" });
    expect(calls).toBe(0);
  });

  it("rejects malformed response bodies and untrusted pagination URLs", () => {
    const path = "/api/v2/accounts/12345/inserviceNumbers";
    expect(() =>
      normalizeBandwidthInventory({ phoneNumbers: ["not-a-number"] }, path),
    ).toThrow("Invalid inventory phone number");
    expect(() =>
      normalizeBandwidthInventory(
        {
          phoneNumbers: [],
          links: {
            next: "https://evil.example/api/v2/accounts/12345/inserviceNumbers?page=1",
          },
        },
        path,
      ),
    ).toThrow("Invalid next page origin");
    expect(() =>
      normalizeBandwidthInventory({ phoneNumbers: "x" }, path),
    ).toThrow("Invalid inventory numbers");
  });

  it("hides missing credentials and rejects unsafe references", () => {
    expect(() =>
      credentials.get({ ...account, credentialRef: "../OTHER" }),
    ).toThrow("Invalid carrier credential reference");
    expect(() =>
      credentials.get({ ...account, credentialRef: "MISSING" }),
    ).toThrow("Carrier credentials unavailable");
  });

  it("maps authentication, rate limits, timeouts, and provider errors", async () => {
    expect(mapHttpError("bandwidth", 401, null)).toMatchObject({
      kind: "authentication",
      retryable: false,
    });
    expect(mapHttpError("bandwidth", 429, "12")).toMatchObject({
      kind: "rate_limited",
      retryable: true,
      retryAfterMs: 12_000,
    });
    expect(mapHttpError("bandwidth", 504, null)).toMatchObject({
      kind: "timeout",
      retryable: true,
    });
    expect(mapHttpError("bandwidth", 503, null)).toMatchObject({
      kind: "upstream",
      retryable: true,
    });
    const transport = new FetchCarrierTransport(
      100,
      async () => new Response("denied", { status: 401 }),
    );
    await expect(
      transport.getJson(
        new URL("https://api.bandwidth.com/test"),
        "Basic secret",
        "bandwidth",
      ),
    ).rejects.toMatchObject({ kind: "authentication" });
    const limited = new FetchCarrierTransport(
      100,
      async () =>
        new Response("slow down", {
          status: 429,
          headers: { "Retry-After": "12" },
        }),
    );
    await expect(
      limited.getJson(
        new URL("https://api.bandwidth.com/test"),
        "Basic secret",
        "bandwidth",
      ),
    ).rejects.toMatchObject({ kind: "rate_limited", retryAfterMs: 12_000 });
  });

  it("enforces request timeouts and never includes credentials in errors", async () => {
    const waiting = (_url: URL | RequestInfo, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    const transport = new FetchCarrierTransport(10, waiting as typeof fetch);
    await expect(
      transport.getJson(
        new URL("https://api.bandwidth.com/test"),
        "Basic secret",
        "bandwidth",
      ),
    ).rejects.toMatchObject({ kind: "timeout", retryable: true });
    try {
      await transport.getJson(
        new URL("https://api.bandwidth.com/test"),
        "Basic secret",
        "bandwidth",
      );
    } catch (error) {
      expect(String(error)).not.toContain("secret");
    }
  });

  it("runs a deterministic mock through the same inventory contract", async () => {
    const mockAccount: CarrierAccount = {
      id: "fixture",
      carrier: "mock",
      nativeAccountId: "fixture",
    };
    const inventory = registry(async () => new Response()).inventory(
      mockAccount,
    );
    const first = await inventory.listInventory(mockAccount, { pageSize: 1 });
    expect(first).toEqual({
      numbers: [
        { e164: "+18043024183", nativeId: "+18043024183", status: "active" },
      ],
      nextPageToken: "1",
      totalCount: 2,
    });
    const second = await inventory.listInventory(mockAccount, {
      pageSize: 1,
      pageToken: first.nextPageToken,
    });
    expect(second.numbers[0].e164).toBe("+18042121778");
    expect(second.nextPageToken).toBeUndefined();
  });
});
