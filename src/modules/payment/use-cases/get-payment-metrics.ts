import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PAYMENTS_READ } from "@/src/modules/payment/constants";
import * as paymentRepo from "@/src/modules/payment/repo";
import type { PaymentMetrics } from "@/src/modules/payment/repo";

export type { PaymentMetrics };

/** Admin dashboard read (docs/PHASE_10_ADMIN_PLAN.md §9) — `payments.read`,
 * same permission the existing reconciliation read already requires. */
export async function getPaymentMetrics(
  actor: AuthenticatedUser,
): Promise<PaymentMetrics> {
  requirePermission(actor, PERMISSION_PAYMENTS_READ);
  return paymentRepo.getPaymentMetrics();
}
