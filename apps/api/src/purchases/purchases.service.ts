import { BadRequestException, Injectable } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { CarrierRegistryService } from "../carriers/registry";
import type { CarrierAccount, CarrierCode } from "../carriers/domain";
import { CARRIER_CODES } from "../carriers/domain";
import { CarrierError } from "../carriers/errors";
import { DatabaseService } from "../database/database.service";

interface CarrierRecord {
  _id: ObjectId;
  code: CarrierCode;
  displayName: string;
}
interface CarrierAccountRecord {
  _id: ObjectId;
  carrierId: ObjectId;
  externalAccountId: string;
  credentialRef?: string;
  status: string;
}

function normalizeOffer(raw: string): string {
  const digits = raw.replace(/[().\s-]/g, "");
  const e164 = /^\d{10}$/.test(digits)
    ? `+1${digits}`
    : /^1\d{10}$/.test(digits)
      ? `+${digits}`
      : digits;
  if (!/^\+[1-9]\d{1,14}$/.test(e164))
    throw new Error("Invalid carrier offer number");
  return e164;
}

@Injectable()
export class PurchasesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly carriers: CarrierRegistryService,
  ) {}

  async search(input: {
    areaCode?: string;
    city?: string;
    region?: string;
    pattern?: string;
    quantity?: number;
    carrier?: CarrierCode;
  }) {
    const areaCode = input.areaCode?.trim();
    const city = input.city?.trim();
    const region = input.region?.trim().toUpperCase();
    const pattern = input.pattern?.trim();
    const quantity = input.quantity ?? 10;
    if (input.carrier && !CARRIER_CODES.includes(input.carrier))
      throw new BadRequestException("Invalid carrier filter");
    if (areaCode && !/^\d{3}$/.test(areaCode))
      throw new BadRequestException("Invalid area code");
    if (city && !/^[A-Za-z][A-Za-z .'-]{1,79}$/.test(city))
      throw new BadRequestException("Invalid city");
    if (region && !/^[A-Z]{2}$/.test(region))
      throw new BadRequestException("Invalid state");
    if (pattern && !/^[0-9*?]{2,15}$/.test(pattern))
      throw new BadRequestException("Invalid number pattern");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50)
      throw new BadRequestException("Invalid search quantity");
    if (!areaCode && !city && !region && !pattern)
      throw new BadRequestException("Provide at least one search filter");
    await this.database.ensureReady();
    const db = this.database.nativeDb();
    const carrierRecords = await db
      .collection<CarrierRecord>("carriers")
      .find()
      .toArray();
    const byId = new Map(
      carrierRecords.map((carrier) => [carrier._id.toHexString(), carrier]),
    );
    const accounts = await db
      .collection<CarrierAccountRecord>("carrier_accounts")
      .find({ status: "active" })
      .toArray();
    const selected = accounts.flatMap((account) => {
      const carrier = byId.get(account.carrierId.toHexString());
      if (
        !carrier ||
        (input.carrier && carrier.code !== input.carrier) ||
        !this.carriers.capabilities(carrier.code).includes("number.search")
      )
        return [];
      return [{ account, carrier }];
    });
    const results = await Promise.all(
      selected.map(async ({ account, carrier }) => {
        const reference: CarrierAccount = {
          id: account._id.toHexString(),
          carrier: carrier.code,
          nativeAccountId: account.externalAccountId,
          credentialRef: account.credentialRef,
        };
        try {
          const raw = await this.carriers
            .search(reference)
            .searchNumbers(reference, {
              areaCode,
              city,
              region,
              pattern,
              quantity,
            });
          const offers = raw.slice(0, quantity).map((offer) => {
            if (!offer.nativeId || offer.nativeId.length > 128)
              throw new Error("Invalid offer identity");
            for (const cents of [
              offer.monthlyPriceCents,
              offer.setupPriceCents,
            ]) {
              if (
                cents !== undefined &&
                (!Number.isSafeInteger(cents) || cents < 0)
              )
                throw new Error("Invalid offer pricing");
            }
            return {
              e164: normalizeOffer(offer.e164),
              nativeId: offer.nativeId,
              carrier: carrier.code,
              carrierName: carrier.displayName,
              carrierAccountId: account._id.toHexString(),
              locality: offer.locality,
              region: offer.region,
              monthlyPriceCents: offer.monthlyPriceCents,
              setupPriceCents: offer.setupPriceCents,
              currency: offer.currency,
            };
          });
          return { offers, error: null };
        } catch (error) {
          return {
            offers: [],
            error: {
              carrier: carrier.code,
              carrierAccountId: account._id.toHexString(),
              code:
                error instanceof CarrierError ? error.kind : "invalid_response",
            },
          };
        }
      }),
    );
    const offers = results.flatMap((result) => result.offers);
    offers.sort(
      (a, b) =>
        (a.monthlyPriceCents ?? Number.MAX_SAFE_INTEGER) -
          (b.monthlyPriceCents ?? Number.MAX_SAFE_INTEGER) ||
        a.e164.localeCompare(b.e164),
    );
    return {
      offers,
      errors: results.flatMap((result) => (result.error ? [result.error] : [])),
    };
  }
}
