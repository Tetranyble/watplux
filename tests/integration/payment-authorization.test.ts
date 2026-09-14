import { afterAll, describe, expect, it } from "vitest";

import {
  cleanupCatalogTestData,
  createCustomerActor,
  createStaffActor,
  createSuperAdminActor,
} from "./helpers/catalog-fixtures";
import { cleanupCartTestData } from "./helpers/cart-fixtures";
import { cleanupInventoryTestData } from "./helpers/inventory-fixtures";
import {
  cleanupOrderTestData,
  createStockedProduct,
} from "./helpers/order-fixtures";
import {
  checkoutAndInitializePayment,
  cleanupPaymentTestData,
} from "./helpers/payment-fixtures";
import { listPaymentAttemptsForOrder } from "@/src/modules/payment/use-cases/list-payment-attempts-for-order";

/** Every mandatory IDOR scenario (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md
 * §21/§22), mirroring `order-authorization.test.ts`'s established
 * conventions. */
describe("payment: authorization / IDOR", () => {
  afterAll(async () => {
    await cleanupPaymentTestData();
    await cleanupCartTestData();
    await cleanupOrderTestData();
    await cleanupInventoryTestData();
    await cleanupCatalogTestData();
  });

  it("a user can read their own order's payment attempts", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const { order } = await checkoutAndInitializePayment(customer, variantId);

    const attempts = await listPaymentAttemptsForOrder(
      customer,
      BigInt(order.id),
    );
    expect(attempts).toHaveLength(1);
  });

  it("User A cannot read User B's order's payment attempts", async () => {
    const customerA = await createCustomerActor();
    const customerB = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const { order } = await checkoutAndInitializePayment(customerB, variantId);

    await expect(
      listPaymentAttemptsForOrder(customerA, BigInt(order.id)),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("manipulating the order id does not bypass the check — a nonexistent id is denied with 404, not silently accepted", async () => {
    const customer = await createCustomerActor();
    await expect(
      listPaymentAttemptsForOrder(customer, BigInt(999_999_999)),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("an admin with payments.read (super_admin) can read any order's payment attempts — the sanctioned elevated path, not a bypass", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const { order } = await checkoutAndInitializePayment(customer, variantId);

    const attempts = await listPaymentAttemptsForOrder(admin, BigInt(order.id));
    expect(attempts).toHaveLength(1);
  });

  it("staff (payments.read, no payments.refund) can read payment attempts for any order", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const staff = await createStaffActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const { order } = await checkoutAndInitializePayment(customer, variantId);

    const attempts = await listPaymentAttemptsForOrder(staff, BigInt(order.id));
    expect(attempts).toHaveLength(1);
  });

  it("staff (no payments.refund) cannot request a refund — permission-gated, not ownership-gated", async () => {
    const customer = await createCustomerActor();
    const admin = await createSuperAdminActor();
    const staff = await createStaffActor();
    const { variantId } = await createStockedProduct(admin, {
      quantity: 5,
      priceMinor: 20_000,
    });
    const { order } = await checkoutAndInitializePayment(customer, variantId);

    const { createSuccessVerifyingClient } =
      await import("./helpers/fake-paystack-client");
    const { verifyAndProcessPayment } =
      await import("@/src/modules/payment/use-cases/verify-and-process-payment");
    const { db } = await import("@/lib/db");
    const attempt = await db.paymentAttempt.findFirstOrThrow({
      where: { orderId: BigInt(order.id) },
    });
    await verifyAndProcessPayment(
      attempt.id,
      createSuccessVerifyingClient(20_000),
    );

    const { requestRefund } =
      await import("@/src/modules/payment/use-cases/request-refund");
    await expect(requestRefund(staff, attempt.id, {})).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
