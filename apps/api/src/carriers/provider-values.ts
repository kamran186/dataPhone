import { CarrierError } from "./errors";
import type { CarrierCode } from "./domain";
export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function array(value: unknown): unknown[] {
  return value === undefined || value === null || value === ""
    ? []
    : Array.isArray(value)
      ? value
      : [value];
}
export function normalizeCarrierNumber(
  value: unknown,
  carrier: CarrierCode,
): string {
  if (typeof value !== "string" && typeof value !== "number")
    throw new CarrierError(
      "invalid_response",
      carrier,
      "Invalid carrier number",
    );
  const digits = String(value).replace(/[().\s-]/g, "");
  const normalized = /^\d{10}$/.test(digits)
    ? `+1${digits}`
    : /^1\d{10}$/.test(digits)
      ? `+${digits}`
      : digits;
  if (!/^\+[1-9]\d{1,14}$/.test(normalized))
    throw new CarrierError(
      "invalid_response",
      carrier,
      "Invalid carrier number",
    );
  return normalized;
}
export function priceCents(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^\d+(\.\d{1,2})?$/.test(value))
    throw new CarrierError(
      "invalid_response",
      "bulkvs",
      "Invalid carrier price",
    );
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents))
    throw new CarrierError(
      "invalid_response",
      "bulkvs",
      "Invalid carrier price",
    );
  return cents;
}
