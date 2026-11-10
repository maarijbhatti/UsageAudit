import type { ProviderSnapshot, Period } from "@usageaudit/shared-types";
export interface SyncRequest extends Period {
  snapshotId: string;
  observedAt: string;
  customers: string[];
  meters: string[];
}
export interface BillingProviderAdapter {
  testConnection(): Promise<{
    ok: boolean;
    environment: "test" | "live";
    accountId: string | null;
  }>;
  fetchSnapshot(request: SyncRequest): Promise<ProviderSnapshot>;
}
export class FixtureAdapter implements BillingProviderAdapter {
  constructor(private snapshot: ProviderSnapshot) {}
  async testConnection() {
    return { ok: true, environment: "test" as const, accountId: "fixture" };
  }
  async fetchSnapshot(request: SyncRequest) {
    return {
      ...structuredClone(this.snapshot),
      id: request.snapshotId,
      observedAt: request.observedAt,
      summaries: this.snapshot.summaries.map((s) => ({
        ...s,
        snapshotId: request.snapshotId,
        observedAt: request.observedAt,
      })),
    };
  }
}
