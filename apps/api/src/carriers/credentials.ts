import { CarrierError } from "./errors";
import type { CarrierAccount } from "./domain";

export interface CarrierCredentials {
  username: string;
  password: string;
}

export interface CarrierCredentialStore {
  get(account: CarrierAccount): CarrierCredentials;
}

export class EnvironmentCarrierCredentialStore implements CarrierCredentialStore {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  get(account: CarrierAccount): CarrierCredentials {
    const reference = account.credentialRef;
    if (!reference || !/^[A-Z][A-Z0-9_]{1,63}$/.test(reference)) {
      throw new CarrierError(
        "configuration",
        account.carrier,
        "Invalid carrier credential reference",
      );
    }
    const username = this.env[`DATAPHONE_CARRIER_${reference}_USERNAME`];
    const password = this.env[`DATAPHONE_CARRIER_${reference}_PASSWORD`];
    if (!username || !password) {
      throw new CarrierError(
        "configuration",
        account.carrier,
        "Carrier credentials unavailable",
      );
    }
    return { username, password };
  }
}
