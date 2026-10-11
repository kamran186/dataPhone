import type { CarrierCode } from "./domain";
import { CarrierError, mapHttpError } from "./errors";

export interface CarrierTransport {
  getJson(
    url: URL,
    authorization: string,
    carrier: CarrierCode,
  ): Promise<unknown>;
}

export class FetchCarrierTransport implements CarrierTransport {
  constructor(
    private readonly timeoutMs = 10_000,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
      throw new Error("Carrier timeout must be between 1 and 120000 ms");
  }

  async getJson(
    url: URL,
    authorization: string,
    carrier: CarrierCode,
  ): Promise<unknown> {
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
        method: "GET",
        headers: { Accept: "application/json", Authorization: authorization },
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok)
        throw mapHttpError(
          carrier,
          response.status,
          response.headers.get("retry-after"),
        );
      if (response.status === 204) return { phoneNumbers: [] };
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > 1_000_000)
        throw new CarrierError(
          "invalid_response",
          carrier,
          "Carrier response too large",
        );
      const body = await response.text();
      if (body.length > 1_000_000)
        throw new CarrierError(
          "invalid_response",
          carrier,
          "Carrier response too large",
        );
      try {
        return JSON.parse(body) as unknown;
      } catch {
        throw new CarrierError(
          "invalid_response",
          carrier,
          "Carrier response is not JSON",
        );
      }
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
