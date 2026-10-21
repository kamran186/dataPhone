import type { CarrierCode } from "./domain";
import { CarrierError, mapHttpError } from "./errors";
export interface CarrierTransport {
  getJson(
    url: URL,
    authorization: string,
    carrier: CarrierCode,
    maxBytes?: number,
    emptyOn404?: boolean,
  ): Promise<unknown>;
  postXml?(
    url: URL,
    body: string,
    carrier: CarrierCode,
    maxBytes?: number,
  ): Promise<string>;
}
export class FetchCarrierTransport implements CarrierTransport {
  constructor(
    private readonly timeoutMs = 10000,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
      throw new Error("Carrier timeout must be between 1 and 120000 ms");
  }
  async getJson(
    url: URL,
    authorization: string,
    carrier: CarrierCode,
    maxBytes = 1000000,
    emptyOn404 = false,
  ): Promise<unknown> {
    const body = await this.request(
      url,
      carrier,
      {
        method: "GET",
        headers: { Accept: "application/json", Authorization: authorization },
      },
      maxBytes,
      emptyOn404,
    );
    if (!body) return carrier === "bandwidth" ? { phoneNumbers: [] } : [];
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new CarrierError(
        "invalid_response",
        carrier,
        "Carrier response is not JSON",
      );
    }
  }
  async postXml(
    url: URL,
    body: string,
    carrier: CarrierCode,
    maxBytes = 32000000,
  ) {
    return this.request(
      url,
      carrier,
      {
        method: "POST",
        headers: {
          Accept: "text/xml",
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: '""',
        },
        body,
      },
      maxBytes,
    );
  }
  private async request(
    url: URL,
    carrier: CarrierCode,
    init: RequestInit,
    maxBytes: number,
    emptyOn404 = false,
  ): Promise<string> {
    if (url.protocol !== "https:")
      throw new CarrierError(
        "configuration",
        carrier,
        "Carrier URL must use HTTPS",
      );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url, {
        ...init,
        signal: controller.signal,
        redirect: "error",
      });
      if (response.status === 404 && emptyOn404) return "";
      // SOAP faults may use HTTP 500; parse a bounded XML body before mapping faults.
      if (!response.ok && !(init.method === "POST" && response.status === 500))
        throw mapHttpError(
          carrier,
          response.status,
          response.headers.get("retry-after"),
        );
      if (response.status === 204) return "";
      if (Number(response.headers.get("content-length") ?? 0) > maxBytes)
        throw new CarrierError(
          "invalid_response",
          carrier,
          "Carrier response too large",
        );
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.length;
            if (size > maxBytes) {
              controller.abort();
              throw new CarrierError(
                "invalid_response",
                carrier,
                "Carrier response too large",
              );
            }
            chunks.push(chunk.value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      return Buffer.concat(chunks).toString("utf8");
    } catch (error) {
      if (error instanceof CarrierError) throw error;
      if (controller.signal.aborted)
        throw new CarrierError(
          "timeout",
          carrier,
          "Carrier request timed out",
          true,
        );
      throw new CarrierError(
        "upstream",
        carrier,
        "Carrier request failed",
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
