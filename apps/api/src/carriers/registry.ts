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
  NumberSearchCapability,
  NumberPurchaseCapability,
  OrderStatusCapability,
  NumberDisconnectCapability,
  NumberPortabilityCapability,
  PortSubmissionCapability,
} from "./domain";
import { CarrierError, unsupportedCapability } from "./errors";
import { FetchCarrierTransport } from "./transport";
import { DatabaseService } from "../database/database.service";
import { LocalMockAdapter, localMockEnabled } from "./local-mock";

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

  search(account: CarrierAccount): NumberSearchCapability {
    const adapter = this.resolve(account, "number.search");
    if (!adapter.numberSearch)
      throw unsupportedCapability(account.carrier, "number.search");
    return adapter.numberSearch;
  }

  purchase(account: CarrierAccount): NumberPurchaseCapability {
    const adapter = this.resolve(account, "number.purchase");
    if (!adapter.purchase)
      throw unsupportedCapability(account.carrier, "number.purchase");
    return adapter.purchase;
  }

  orderStatus(account: CarrierAccount): OrderStatusCapability {
    const adapter = this.resolve(account, "order.status");
    if (!adapter.orderStatus)
      throw unsupportedCapability(account.carrier, "order.status");
    return adapter.orderStatus;
  }

  disconnect(account: CarrierAccount): NumberDisconnectCapability {
    const adapter = this.resolve(account, "number.disconnect");
    if (!adapter.disconnect)
      throw unsupportedCapability(account.carrier, "number.disconnect");
    return adapter.disconnect;
  }

  portability(account: CarrierAccount): NumberPortabilityCapability {
    const adapter = this.resolve(account, "number.portability");
    if (!adapter.portability)
      throw unsupportedCapability(account.carrier, "number.portability");
    return adapter.portability;
  }

  portSubmission(account: CarrierAccount): PortSubmissionCapability {
    const adapter = this.resolve(account, "port.submit");
    if (!adapter.portSubmission)
      throw unsupportedCapability(account.carrier, "port.submit");
    return adapter.portSubmission;
  }

  capabilities(code: CarrierCode): CarrierCapability[] {
    return [...(this.adapters.get(code)?.capabilities ?? [])];
  }
}

@Injectable()
export class CarrierRegistryService extends CarrierRegistry {
  constructor(database: DatabaseService) {
    super([
      new PeerlessSoapAdapter(),
      new BulkVsSoapAdapter(),
      new BandwidthAdapter(
        new EnvironmentCarrierCredentialStore(),
        new FetchCarrierTransport(),
      ),
      ...(localMockEnabled() ? [new LocalMockAdapter(database)] : []),
    ]);
  }
}
