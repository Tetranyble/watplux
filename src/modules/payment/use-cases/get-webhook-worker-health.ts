import * as paymentRepo from "@/src/modules/payment/repo";

export interface WebhookWorkerHealth {
  status: "healthy" | "degraded";
  pendingCount: number;
  processingCount: number;
  staleProcessingCount: number;
  failedCount: number;
  exhaustedCount: number;
  oldestPendingReceivedAt: string | null;
  checkedAt: string;
}

export async function getWebhookWorkerHealth(): Promise<WebhookWorkerHealth> {
  const snapshot = await paymentRepo.getWebhookWorkerHealthSnapshot();
  const degraded =
    snapshot.staleProcessingCount > 0 ||
    snapshot.failedCount > 0 ||
    snapshot.exhaustedCount > 0;
  return {
    status: degraded ? "degraded" : "healthy",
    ...snapshot,
    oldestPendingReceivedAt:
      snapshot.oldestPendingReceivedAt?.toISOString() ?? null,
    checkedAt: new Date().toISOString(),
  };
}
