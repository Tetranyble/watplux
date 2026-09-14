import { NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import * as cartRepo from "@/src/modules/cart/repo";
import type { CartOwner } from "@/src/modules/cart/types";
import * as checkoutRepo from "@/src/modules/checkout/repo";
import type {
  AddressInput,
  CompleteCheckoutInput,
} from "@/src/modules/checkout/schema";
import { toOrderDetail } from "@/src/modules/order/types";
import type { OrderAddressData } from "@/src/modules/order/repo";
import type { OrderDetail } from "@/src/modules/order/types";
// Cross-module use-case-to-use-case composition — ESLint-legal, the same
// pattern `order/use-cases/create-order.ts` already established calling
// into Inventory's use-case layer (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md
// §35 step 8). Checkout's own transaction has already committed by the
// time this runs (plan §6.3/§26) — no external call ever occurs inside a
// database transaction here.
import { defaultPaystackClient } from "@/src/integrations/paystack/client";
import { generateGuestOrderToken } from "@/src/integrations/crypto/guest-order-token";
import { env } from "@/lib/env";
import { GUEST_ORDER_TOKEN_TTL_SECONDS } from "@/src/modules/payment/constants";
import { initializePayment } from "@/src/modules/payment/use-cases/initialize-payment";
import type {
  InitializePaymentResult,
  PaystackClient,
} from "@/src/modules/payment/types";

export interface CompleteCheckoutOutcome {
  order: OrderDetail;
  payment: InitializePaymentResult;
  /**
   * Present only for guest orders when `GUEST_ORDER_TOKEN_SECRET` is
   * configured (docs/PHASE_9_STOREFRONT_PLAN.md §13.4 Option A) — the
   * storefront must carry this forward to `/checkout/payment-result` so
   * the guest can check their own order's status without a session.
   * `undefined` for authenticated checkouts (a session already covers
   * that) and for guest checkouts when no secret is configured (falls
   * back to the no-live-status guest experience, plan §13.4 Option B).
   */
  guestOrderAccessToken?: string;
}

/**
 * Performs the complete atomic checkout transaction (plan §16), creates
 * the initial payment attempt (plan §18, unchanged Phase 7 step), then —
 * the additive Phase 8 extension — initializes it with Paystack
 * (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §6.3/§8/§35 step 8). Returns the
 * created `Order` per Phase 6's `OrderDetail` DTO convention (plan §25)
 * plus the payment-initialization outcome — the client never sees
 * `priceSnapshotMinor` or any other cart-stored field; everything is
 * re-resolved server-side inside `checkoutRepo.completeCheckout`.
 *
 * A Paystack initialization failure NEVER fails this use-case or rolls
 * back the already-committed order — `initializePayment` itself resolves
 * every Paystack-side failure to an `INITIALIZATION_FAILED` outcome
 * rather than throwing (plan §8), and the defensive `catch` below exists
 * only to guarantee that invariant holds even against a genuinely
 * unexpected bug in the payment module, never letting a successful
 * checkout's response turn into an error.
 *
 * `cartId` is never accepted as an input parameter — identity (`owner`)
 * resolves the cart, matching Cart's own established convention (plan
 * §23/§27: "cartId isn't even part of most inputs").
 */
export async function completeCheckout(
  owner: CartOwner,
  input: CompleteCheckoutInput,
  actorEmail: string | null = null,
  paystackClient: PaystackClient = defaultPaystackClient,
): Promise<CompleteCheckoutOutcome> {
  // Cart existence is checked BEFORE the guest-email requirement — a
  // caller with no cart at all should see "cart not found," not be
  // nagged for an email address for a checkout that has nothing to
  // check out in the first place.
  const cartId = await cartRepo.findActiveCartId(owner);
  if (!cartId) {
    throw new NotFoundError("Cart not found.");
  }

  if (owner.type === "guest" && !input.guestEmail) {
    throw new ValidationError(
      "Guest checkout requires a contact email address.",
    );
  }

  const result = await checkoutRepo.completeCheckout({
    cartId,
    owner,
    userId: owner.type === "user" ? owner.userId : null,
    guestEmail: owner.type === "guest" ? (input.guestEmail ?? null) : null,
    guestPhone: owner.type === "guest" ? (input.guestPhone ?? null) : null,
    customerNote: input.customerNote ?? null,
    shippingAddress: toOrderAddressData("SHIPPING", input.shippingAddress),
    billingAddress: input.billingAddress
      ? toOrderAddressData("BILLING", input.billingAddress)
      : null,
    initialActorId: owner.type === "user" ? owner.userId : null,
  });

  const email =
    owner.type === "guest" ? (input.guestEmail ?? "") : (actorEmail ?? "");

  let payment: InitializePaymentResult;
  try {
    payment = await initializePayment(
      result.paymentAttemptId,
      email,
      paystackClient,
    );
  } catch (error) {
    // Defensive only — see the function doc comment. `initializePayment`
    // itself should never throw here in practice.
    logger.error(
      { err: error, orderId: result.order.id.toString() },
      "Unexpected error initializing payment after checkout — order was still created successfully",
    );
    payment = {
      outcome: "INITIALIZATION_FAILED",
      errorCode: "UNKNOWN_ERROR",
      errorMessage: "An unexpected error occurred while starting payment.",
    };
  }

  const guestOrderAccessToken =
    owner.type === "guest"
      ? (generateGuestOrderToken(
          result.order.id,
          env.GUEST_ORDER_TOKEN_SECRET,
          GUEST_ORDER_TOKEN_TTL_SECONDS,
          new Date(),
        ) ?? undefined)
      : undefined;

  return { order: toOrderDetail(result.order), payment, guestOrderAccessToken };
}

function toOrderAddressData(
  type: "SHIPPING" | "BILLING",
  input: AddressInput,
): OrderAddressData {
  return {
    type,
    fullName: input.fullName,
    phone: input.phone,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2 ?? null,
    city: input.city,
    state: input.state,
    country: input.country,
    postalCode: input.postalCode ?? null,
    deliveryNotes: input.deliveryNotes ?? null,
  };
}
