import type { CarrierCapability, CarrierCode } from "./domain";

export type CarrierErrorKind =
  | "unsupported"
  | "authentication"
  | "rate_limited"
  | "timeout"
  | "invalid_request"
  | "upstream"
  | "invalid_response"
  | "configuration";

export class CarrierError extends Error {
  constructor(
    readonly kind: CarrierErrorKind,
    readonly carrier: CarrierCode,
    message: string,
    readonly retryable = false,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "CarrierError";
  }
}

export function unsupportedCapability(
  carrier: CarrierCode,
  capability: CarrierCapability,
): CarrierError {
  return new CarrierError(
    "unsupported",
    carrier,
    `${carrier} does not support ${capability} in this deployment`,
  );
}

function retryDelay(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(header) - Date.now();
  return Number.isFinite(delay)
    ? Math.min(3_600_000, Math.max(0, delay))
    : undefined;
}

export function mapHttpError(
  carrier: CarrierCode,
  status: number,
  retryAfter: string | null,
): CarrierError {
  if (status === 401 || status === 403)
    return new CarrierError(
      "authentication",
      carrier,
      "Carrier authentication failed",
    );
  if (status === 429)
    return new CarrierError(
      "rate_limited",
      carrier,
      "Carrier rate limit reached",
      true,
      retryDelay(retryAfter),
    );
  if (status === 408 || status === 504)
    return new CarrierError(
      "timeout",
      carrier,
      "Carrier request timed out",
      true,
    );
  if (status >= 500)
    return new CarrierError(
      "upstream",
      carrier,
      "Carrier service failed",
      true,
    );
  return new CarrierError(
    "invalid_request",
    carrier,
    "Carrier rejected request",
  );
}
