import {
  PeerlessSoapAdapter,
  peerlessResponse,
} from "../src/carriers/peerless";
import { BulkVsRestAdapter } from "../src/carriers/bulkvs";
import { BandwidthAdapter } from "../src/carriers/adapters";
import { EnvironmentCarrierCredentialStore } from "../src/carriers/credentials";
import {
  FetchCarrierTransport,
  type CarrierTransport,
} from "../src/carriers/transport";
import type { CarrierAccount } from "../src/carriers/domain";
const credentials = new EnvironmentCarrierCredentialStore({
  DATAPHONE_CARRIER_TEST_USERNAME: "reader",
  DATAPHONE_CARRIER_TEST_PASSWORD: "secret",
  DATAPHONE_CARRIER_TEST_CUSTOMER: "customer",
});
const account = (carrier: CarrierAccount["carrier"]): CarrierAccount => ({
  id: "local",
  nativeAccountId: "12345",
  credentialRef: "TEST",
  carrier,
});
const xml = (operation: string, result: string) =>
  `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><p:${operation}Response xmlns:p="http://publicapi.api.s2.peerless.com/">${result}</p:${operation}Response></s:Body></s:Envelope>`;
describe("read-only live carrier contracts", () => {
  it("reads Peerless inventory and search with escaped SOAP credentials and only read operations", async () => {
    const bodies: string[] = [];
    const transport: CarrierTransport = {
      getJson: async () => {
        throw new Error("unexpected REST call");
      },
      postXml: async (url, body) => {
        expect(url.href).toBe(
          "https://aniweb02.peerlessnetwork.com:8181/animateapi/axis/APIService",
        );
        bodies.push(body);
        if (body.includes("<p:getTnInventoryReport>"))
          return xml(
            "getTnInventoryReport",
            "<return><number>2125550100</number><status>Active</status></return>",
          );
        return xml(
          "searchNumbers",
          "<return><tnCount>1</tnCount><result><tn><number>12125550101</number><category>LOCAL</category></tn></result></return>",
        );
      },
    };
    const adapter = new PeerlessSoapAdapter(credentials, transport);
    expect(
      (await adapter.inventory.listInventory(account("peerless"))).numbers[0]
        .e164,
    ).toBe("+12125550100");
    expect(
      await adapter.numberSearch.searchNumbers(account("peerless"), {
        areaCode: "212",
        quantity: 2,
      }),
    ).toMatchObject([{ e164: "+12125550101" }]);
    expect(bodies[0]).toContain("<customer>customer</customer>");
    expect(bodies[0]).toContain("<userId>reader</userId>");
    expect(bodies[1]).toContain("<npa>212</npa>");
    expect([...adapter.capabilities]).toEqual([
      "inventory.list",
      "number.search",
    ]);
    await expect(
      adapter.searchNumbers(account("peerless"), {
        pattern: "*1000",
        quantity: 2,
      }),
    ).rejects.toMatchObject({ kind: "unsupported" });
  });
  it("rejects unsafe XML, SOAP faults, malformed numbers and absent result envelopes", async () => {
    expect(() =>
      peerlessResponse(
        '<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]><x/>',
        "searchNumbers",
      ),
    ).toThrow("Invalid carrier XML");
    expect(() =>
      peerlessResponse(
        '<s:Envelope xmlns:s="x"><s:Body><s:Fault><faultstring>secret</faultstring></s:Fault></s:Body></s:Envelope>',
        "searchNumbers",
      ),
    ).toThrow("SOAP fault");
    expect(() =>
      peerlessResponse(xml("wrongOperation", ""), "searchNumbers"),
    ).toThrow("Missing carrier response");
    const adapter = new PeerlessSoapAdapter(credentials, {
      getJson: async () => [],
      postXml: async () =>
        xml("getTnInventoryReport", "<return><number>broken</number></return>"),
    });
    await expect(
      adapter.listInventory(account("peerless")),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });
  it("reads complete BulkVS account inventory without applying a truncating limit", async () => {
    const adapter = new BulkVsRestAdapter(credentials, {
      getJson: async (url, auth) => {
        expect(url.pathname).toBe("/api/v1.0/tnRecord");
        expect(url.search).toBe("");
        expect(auth).toMatch(/^Basic /);
        return [{ TN: "12125550100", Status: "Active" }];
      },
    });
    expect(await adapter.listInventory(account("bulkvs"))).toMatchObject({
      totalCount: 1,
      numbers: [{ e164: "+12125550100" }],
    });
  });
  it("discovers BulkVS exchanges and searches using both NPA and NXX with exact cents", async () => {
    const paths: string[] = [];
    const adapter = new BulkVsRestAdapter(credentials, {
      getJson: async (url) => {
        paths.push(url.pathname);
        if (url.pathname.endsWith("/exchanges"))
          return {
            Total: 2,
            Data: [
              { Prefix: "212", Quantity: 1, Type: "NPA" },
              { Prefix: "212555", Quantity: 1, Type: "NPANXX" },
            ],
          };
        expect(url.searchParams.get("Npa")).toBe("212");
        expect(url.searchParams.get("Nxx")).toBe("555");
        return [
          {
            TN: "12125550101",
            "Rate Center": "New York",
            State: "NY",
            Mrc: "0.05",
            Nrc: "1.25",
          },
        ];
      },
    });
    expect(
      await adapter.searchNumbers(account("bulkvs"), {
        areaCode: "212",
        quantity: 1,
      }),
    ).toMatchObject({
      numbers: [
        { e164: "+12125550101", monthlyPriceCents: 5, setupPriceCents: 125 },
      ],
      partial: false,
    });
    expect(paths).toEqual(["/api/v1.0/exchanges", "/api/v1.0/orderTn"]);
    await expect(
      adapter.searchNumbers(account("bulkvs"), {
        city: "New York",
        quantity: 1,
      }),
    ).rejects.toMatchObject({ kind: "unsupported" });
  });
  it("bounds BulkVS fan-out and reports partial coverage", async () => {
    let calls = 0;
    const adapter = new BulkVsRestAdapter(credentials, {
      getJson: async (url) => {
        if (url.pathname.endsWith("/exchanges"))
          return {
            Total: 20,
            Data: Array.from({ length: 20 }, (_, i) => ({
              Prefix: `212${200 + i}`,
              Quantity: 1,
              Type: "NPANXX",
            })),
          };
        calls++;
        return [];
      },
    });
    expect(
      await adapter.searchNumbers(account("bulkvs"), {
        areaCode: "212",
        quantity: 10,
      }),
    ).toEqual({ numbers: [], partial: true });
    expect(calls).toBe(10);
  });
  it("uses Bandwidth v2 JSON and documented suffix filters", async () => {
    const adapter = new BandwidthAdapter(credentials, {
      getJson: async (url) => {
        expect(url.pathname).toBe("/api/v2/accounts/12345/availableNumbers");
        expect(url.searchParams.get("countryCodeA3")).toBe("USA");
        expect(url.searchParams.get("localVanity")).toBe("1000");
        expect(url.searchParams.get("endsIn")).toBe("true");
        return {
          resultCount: 1,
          telephoneNumberDetailList: [
            { fullNumber: "+12125551000", city: "New York", state: "NY" },
          ],
        };
      },
    });
    expect(
      await adapter.searchNumbers(account("bandwidth"), {
        areaCode: "212",
        pattern: "*1000",
        quantity: 1,
      }),
    ).toMatchObject([{ e164: "+12125551000", region: "NY" }]);
  });
  it("treats only search 404 responses as no results", async () => {
    const transport = new FetchCarrierTransport(
      100,
      async () => new Response("", { status: 404 }),
    );
    expect(
      await transport.getJson(
        new URL("https://portal.bulkvs.com/api/v1.0/orderTn"),
        "Basic x",
        "bulkvs",
        1000,
        true,
      ),
    ).toEqual([]);
    await expect(
      transport.getJson(
        new URL("https://portal.bulkvs.com/api/v1.0/tnRecord"),
        "Basic x",
        "bulkvs",
      ),
    ).rejects.toMatchObject({ kind: "invalid_request" });
  });
});
