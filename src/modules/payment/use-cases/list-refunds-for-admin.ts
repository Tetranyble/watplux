import { ForbiddenError } from "@/lib/errors";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PAYMENTS_READ } from "@/src/modules/payment/constants";
import * as paymentRepo from "@/src/modules/payment/repo";
import { toRefundRecord } from "@/src/modules/payment/types";
import type { ListRefundsForAdminInput } from "@/src/modules/payment/schema";
import type { CursorPage, RefundRecord } from "@/src/modules/payment/types";

/**
 * `payments.read` (a read, not `payments.refund` — docs/PHASE_10_ADMIN_PLAN.md
 * §14/§31) — the small additive admin-wide refund queue read. Newest-
 * requested-first, keyset-paginated on `(requestedAt, id)`, optionally
 * filtered by `status`. `requestRefund`/`cancelRefund` remain the only
 * ways a refund's status ever changes; this is purely a new read.
 */
export async function listRefundsForAdmin(
  actor: AuthenticatedUser,
  input: ListRefundsForAdminInput,
): Promise<CursorPage<RefundRecord>> {
  if (!actor.permissions.has(PERMISSION_PAYMENTS_READ)) {
    throw new ForbiddenError("You do not have permission to view refunds.");
  }

  const cursor = input.cursor
    ? paymentRepo.decodeRefundListCursor(input.cursor)
    : null;

  const { rows, nextCursor } = await paymentRepo.listRefundsForAdmin({
    status: input.status,
    cursor: cursor ?? undefined,
    limit: input.limit,
  });

  return { items: rows.map(toRefundRecord), nextCursor };
}
