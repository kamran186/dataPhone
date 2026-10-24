export interface Dashboard {
  totalDids: number;
  activeDids: number;
  assigned: number;
  potentiallyUnused: number;
  openPorts: number;
  pendingPurchases: number;
  failedJobs: number;
  byCarrier: Array<{ carrier: string; count: number }>;
  carrierSync: Array<{
    carrier: string;
    account: string;
    status: string;
    lastSyncedAt?: string;
  }>;
}
