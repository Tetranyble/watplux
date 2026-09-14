import { db } from "@/lib/db";
import { generateRawToken, hashToken } from "@/src/integrations/crypto/tokens";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import type { CartOwner } from "@/src/modules/cart/types";

/**
 * A guest identity for direct use-case-level testing — no real cookie is
 * ever issued; this is just the server-side `CartOwner` shape a route
 * would have resolved from one (docs/PHASE_7_CART_CHECKOUT_PLAN.md §5).
 * Tracked in-memory so `cleanupCartTestData` can target exactly (and
 * only) the guest carts this test run created — guest token hashes have
 * no name-prefix to filter by, unlike catalog/order/auth test data.
 */
const testGuestTokenHashes = new Set<string>();

export function createGuestOwner(): CartOwner {
  const guestTokenHash = hashToken(generateRawToken());
  testGuestTokenHashes.add(guestTokenHash);
  return { type: "guest", guestTokenHash };
}

export function ownerForUser(actor: AuthenticatedUser): CartOwner {
  return { type: "user", userId: actor.id };
}

/**
 * Deletes every cart this test run created — guest carts tracked by hash
 * above, plus every cart owned by a `phase3-test-` user (the auth
 * module's own test-user email-prefix convention,
 * `tests/integration/helpers/fixtures.ts`). `cart_items` cascades
 * automatically (`onDelete: Cascade` on both the `cart` and
 * `productVariant` relations) — no separate cleanup needed.
 *
 * MUST run before `cleanupCatalogTestData()` (which deletes the test
 * users this queries by prefix — `carts.userId` is `ON DELETE RESTRICT`)
 * and is independent of `cleanupOrderTestData()`/`cleanupInventoryTestData()`
 * (no `orders.cartId` FK exists — plan §15/§33).
 */
export async function cleanupCartTestData(): Promise<void> {
  if (testGuestTokenHashes.size > 0) {
    await db.cart.deleteMany({
      where: { guestTokenHash: { in: Array.from(testGuestTokenHashes) } },
    });
    testGuestTokenHashes.clear();
  }

  const testUsers = await db.user.findMany({
    where: { email: { startsWith: "phase3-test-" } },
    select: { id: true },
  });
  const userIds = testUsers.map((u) => u.id);
  if (userIds.length > 0) {
    await db.cart.deleteMany({ where: { userId: { in: userIds } } });
  }
}
