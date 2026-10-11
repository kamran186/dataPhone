import { Injectable } from "@nestjs/common";
import {
  BandwidthAdapter,
  BulkVsSoapAdapter,
  PeerlessSoapAdapter,
} from "./adapters";
import { EnvironmentCarrierCredentialStore } from "./credentials";
import type {
  CarrierAccount,
  CarrierAdapter,
  CarrierCapability,
  CarrierCode,
  InventoryCapability,
} from "./domain";
import { CarrierError, unsupportedCapability } from "./errors";
import { FetchCarrierTransport } from "./transport";

export class CarrierRegistry {
  private readonly adapters: Map<CarrierCode, CarrierAdapter>;

  constructor(adapters: CarrierAdapter[]) {
    this.adapters = new Map();
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.code))
        throw new Error(`Duplicate carrier adapter: ${adapter.code}`);
      const contracts = {
        "inventory.list": adapter.inventory,
        "number.search": adapter.numberSearch,
        "number.purchase": adapter.purchase,
        "number.disconnect": adapter.disconnect,
        "number.portability": adapter.portability,
        "port.submit": adapter.portSubmission,
        "order.status": adapter.orderStatus,
        "port.document": adapter.portDocument,
      };
      for (const [capability, implementation] of Object.entries(contracts)) {
        if (
          adapter.capabilities.has(capability as CarrierCapability) !==
          Boolean(implementation)
        )
          throw new Error(
            `Capability contract mismatch: ${adapter.code}/${capability}`,
          );
      }
      this.adapters.set(adapter.code, adapter);
    }
  }

  resolve(
    account: CarrierAccount,
    capability: CarrierCapability,
  ): CarrierAdapter {
    const adapter = this.adapters.get(account.carrier);
    if (!adapter)
      throw new CarrierError(
        "configuration",
        account.carrier,
        "Carrier adapter unavailable",
      );
    if (!adapter.capabilities.has(capability))
      throw unsupportedCapability(account.carrier, capability);
    return adapter;
  }

  inventory(account: CarrierAccount): InventoryCapability {
    const adapter = this.resolve(account, "inventory.list");
    if (!adapter.inventory)
      throw unsupportedCapability(account.carrier, "inventory.list");
    return adapter.inventory;
  }

  capabilities(code: CarrierCode): CarrierCapability[] {
    return [...(this.adapters.get(code)?.capabilities ?? [])];
  }
}

@Injectable()
export class CarrierRegistryService extends CarrierRegistry {
  constructor() {
    super([
      new PeerlessSoapAdapter(),
      new BulkVsSoapAdapter(),
      new BandwidthAdapter(
        new EnvironmentCarrierCredentialStore(),
        new FetchCarrierTransport(),
      ),
    ]);
  }
}
