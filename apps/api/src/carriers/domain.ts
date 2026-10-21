export const CARRIER_CODES = [
  "peerless",
  "bulkvs",
  "bandwidth",
  "mock",
] as const;
export type CarrierCode = (typeof CARRIER_CODES)[number];

export const CARRIER_CAPABILITIES = [
  "inventory.list",
  "number.search",
  "number.purchase",
  "number.disconnect",
  "number.portability",
  "port.submit",
  "order.status",
  "port.document",
] as const;
export type CarrierCapability = (typeof CARRIER_CAPABILITIES)[number];

export interface CarrierAccount {
  id: string;
  carrier: CarrierCode;
  nativeAccountId: string;
  credentialRef?: string;
}

export interface InventoryRequest {
  pageSize?: number;
  pageToken?: string;
}

export interface InventoryNumber {
  e164: string;
  nativeId: string;
  status: "active";
}

export interface InventoryPage {
  numbers: InventoryNumber[];
  nextPageToken?: string;
  totalCount?: number;
}

export interface InventoryCapability {
  listInventory(
    account: CarrierAccount,
    request: InventoryRequest,
  ): Promise<InventoryPage>;
}

export interface AvailableNumber {
  e164: string;
  nativeId: string;
  locality?: string;
  region?: string;
  monthlyPriceCents?: number;
  setupPriceCents?: number;
  currency?: string;
}

export interface NumberSearchRequest {
  areaCode?: string;
  city?: string;
  region?: string;
  pattern?: string;
  quantity: number;
}
export interface NumberSearchCapability {
  searchNumbers(
    account: CarrierAccount,
    request: NumberSearchRequest,
  ): Promise<
    AvailableNumber[] | { numbers: AvailableNumber[]; partial?: boolean }
  >;
}

export interface CarrierOrder {
  nativeOrderId: string;
  status: "pending" | "complete" | "failed";
  numbers: string[];
  nativeStatus?: string;
  focDate?: string;
  rejectionReason?: string;
}

export interface NumberPurchaseCapability {
  purchaseNumbers(
    account: CarrierAccount,
    request: { nativeIds: string[]; idempotencyKey: string },
  ): Promise<CarrierOrder>;
}

export interface NumberDisconnectCapability {
  disconnectNumber(
    account: CarrierAccount,
    request: { e164: string; idempotencyKey: string },
  ): Promise<CarrierOrder>;
}

export interface NumberPortabilityCapability {
  checkPortability(
    account: CarrierAccount,
    e164: string,
  ): Promise<{ portable: boolean }>;
}

export interface PortSubmissionCapability {
  submitPort(
    account: CarrierAccount,
    request: { reference: string; numbers: string[]; documentIds: string[] },
  ): Promise<CarrierOrder>;
}

export interface OrderStatusCapability {
  getOrderStatus(
    account: CarrierAccount,
    nativeOrderId: string,
  ): Promise<CarrierOrder>;
}

export interface PortDocumentCapability {
  attachDocument(
    account: CarrierAccount,
    request: { nativeOrderId: string; documentId: string; content: Uint8Array },
  ): Promise<void>;
}

export interface CarrierAdapter {
  readonly code: CarrierCode;
  readonly capabilities: ReadonlySet<CarrierCapability>;
  readonly inventory?: InventoryCapability;
  readonly numberSearch?: NumberSearchCapability;
  readonly purchase?: NumberPurchaseCapability;
  readonly disconnect?: NumberDisconnectCapability;
  readonly portability?: NumberPortabilityCapability;
  readonly portSubmission?: PortSubmissionCapability;
  readonly orderStatus?: OrderStatusCapability;
  readonly portDocument?: PortDocumentCapability;
}
