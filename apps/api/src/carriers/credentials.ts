import { CarrierError } from "./errors";
import type { CarrierAccount } from "./domain";
export interface CarrierCredentials {
  username: string;
  password: string;
  customer?: string;
  authorization?: string;
}
export interface CarrierCredentialStore {
  get(account: CarrierAccount): CarrierCredentials;
}
export class EnvironmentCarrierCredentialStore implements CarrierCredentialStore {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}
  get(account: CarrierAccount): CarrierCredentials {
    const ref = account.credentialRef;
    if (!ref || !/^[A-Z][A-Z0-9_]{1,63}$/.test(ref))
      throw new CarrierError(
        "configuration",
        account.carrier,
        "Invalid carrier credential reference",
      );
    const prefix = `DATAPHONE_CARRIER_${ref}_`;
    const username = this.env[prefix + "USERNAME"] ?? "";
    const password = this.env[prefix + "PASSWORD"] ?? "";
    const customer = this.env[prefix + "CUSTOMER"];
    const authorization = this.env[prefix + "AUTHORIZATION"];
    if (account.carrier === "peerless" && (!username || !password || !customer))
      throw new CarrierError(
        "configuration",
        account.carrier,
        "Peerless credentials unavailable",
      );
    if (account.carrier === "bulkvs" && authorization) {
      if (!/^(Basic|Bearer) [A-Za-z0-9+/=_\-.]+$/.test(authorization))
        throw new CarrierError(
          "configuration",
          account.carrier,
          "Invalid BulkVS authorization",
        );
    } else if (!username || !password)
      throw new CarrierError(
        "configuration",
        account.carrier,
        "Carrier credentials unavailable",
      );
    return { username, password, customer, authorization };
  }
}
export function basicAuth(credentials: CarrierCredentials) {
  return (
    credentials.authorization ??
    `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`
  );
}
