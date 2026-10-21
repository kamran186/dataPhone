import { XMLParser, XMLValidator } from "fast-xml-parser";
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
  type CarrierCredentialStore,
} from "./credentials";
import { CarrierError } from "./errors";
import { FetchCarrierTransport, type CarrierTransport } from "./transport";
import { normalizeCarrierNumber, object, array } from "./provider-values";
const endpoint =
  "https://aniweb02.peerlessnetwork.com:8181/animateapi/axis/APIService";
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
export function peerlessResponse(body: string, operation: string): unknown {
  if (/<!DOCTYPE|<!ENTITY/i.test(body) || XMLValidator.validate(body) !== true)
    throw new CarrierError(
      "invalid_response",
      "peerless",
      "Invalid carrier XML",
    );
  const parser = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: true,
    parseTagValue: false,
    processEntities: false,
  });
  const envelope = object(parser.parse(body));
  const soap = object(object(envelope.Envelope).Body);
  if (soap.Fault)
    throw new CarrierError("upstream", "peerless", "Peerless SOAP fault");
  if (!Object.hasOwn(soap, operation + "Response"))
    throw new CarrierError(
      "invalid_response",
      "peerless",
      "Missing carrier response",
    );
  const result = object(soap[operation + "Response"]);
  return (
    result.return ??
    (operation === "getTnInventoryReport" ? [] : { tnCount: "0" })
  );
}
export class PeerlessSoapAdapter implements CarrierAdapter {
  readonly code = "peerless";
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
  private async call(
    account: CarrierAccount,
    operation: "getTnInventoryReport" | "searchNumbers",
    parameters: string,
  ) {
    if (account.carrier !== this.code || !this.transport.postXml)
      throw new CarrierError(
        "configuration",
        this.code,
        "Invalid Peerless configuration",
      );
    const c = this.credentials.get(account);
    if (!c.customer)
      throw new CarrierError(
        "configuration",
        this.code,
        "Peerless customer unavailable",
      );
    const auth = `<authentication><customer>${escape(c.customer)}</customer><passCode>${escape(c.password)}</passCode><userId>${escape(c.username)}</userId></authentication>`;
    const body = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:p="http://publicapi.api.s2.peerless.com/"><soap:Body><p:${operation}>${auth}${parameters}</p:${operation}></soap:Body></soap:Envelope>`;
    return peerlessResponse(
      await this.transport.postXml(new URL(endpoint), body, this.code),
      operation,
    );
  }
  async listInventory(account: CarrierAccount): Promise<InventoryPage> {
    const raw = await this.call(account, "getTnInventoryReport", "");
    const numbers = array(raw)
      .filter((value) => value !== "")
      .map((value) => {
        const row = object(value);
        return {
          e164: normalizeCarrierNumber(row.number, this.code),
          nativeId: String(row.number),
          status: "active" as const,
        };
      });
    return { numbers, totalCount: numbers.length };
  }
  async searchNumbers(
    account: CarrierAccount,
    request: NumberSearchRequest,
  ): Promise<AvailableNumber[]> {
    if (request.pattern && !/^\d{4,7}$/.test(request.pattern))
      throw new CarrierError(
        "unsupported",
        this.code,
        "Peerless supports digit vanity searches without wildcards",
      );
    const list = (name: string, item: string, value?: string) =>
      value ? `<${name}><${item}>${escape(value)}</${item}></${name}>` : "";
    const filters =
      list("states", "state", request.region) +
      list("locations", "location", request.city) +
      list("npas", "npa", request.areaCode) +
      `<quantity>${request.quantity}</quantity><consecutive>0</consecutive>` +
      (request.pattern
        ? `<vanityDigits>${escape(request.pattern)}</vanityDigits>`
        : "") +
      "<tnCount>0</tnCount>";
    const result = object(
      await this.call(
        account,
        "searchNumbers",
        `<filters>${filters}</filters>`,
      ),
    );
    if (!Object.hasOwn(result, "tnCount"))
      throw new CarrierError(
        "invalid_response",
        this.code,
        "Invalid search response",
      );
    return array(object(result.result).tn)
      .map((value) => {
        const row = object(value);
        return {
          e164: normalizeCarrierNumber(row.number, this.code),
          nativeId: String(row.number),
        };
      })
      .slice(0, request.quantity);
  }
}
