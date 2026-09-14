import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { publishProduct } from "@/src/modules/catalog/use-cases/publish-product";
import { restockInventory } from "@/src/modules/inventory/use-cases/restock-inventory";
import { getCustomerMetrics } from "@/src/modules/auth/use-cases/get-customer-metrics";
import { getProductCount } from "@/src/modules/catalog/use-cases/get-product-count";
import { getLowStockCount } from "@/src/modules/inventory/use-cases/get-low-stock-count";
import { getOrderMetrics } from "@/src/modules/order/use-cases/get-order-metrics";
import { getPaymentMetrics } from "@/src/modules/payment/use-cases/get-payment-metrics";
import { verifyAndProcessPayment } from "@/src/modules/payment/use-cases/verify-and-process-payment";
import {
  cleanupCatalogTestData,
  createCustomerActor,
  createStaffActor,
  createSuperAdminActor,
} from "./helpers/catalog-fixtures";
import { cleanupCartTestData } from "./helpers/cart-fixtures";
import { createSuccessVerifyingClient } from "./helpers/fake-paystack-client";
import { cleanupInventoryTestData } from "./helpers/inventory-fixtures";
import {
  cleanupOrderTestData,
  createStockedProduct,
} from "./helpers/order-fixtures";
import {
  checkoutAndInitializePayment,
  cleanupPaymentTestData,
} from "./helpers/payment-fixtures";

/**
 * docs/PHASE_10_ADMIN_PLAN.md §9 — the five new dashboard-metrics
 * use-cases. Each is a thin, permission-gated wrapper around a single
 * new repo read; this file proves the authorization matrix (the part
 * most likely to regress silently) and that each number reflects real,
 * freshly-created database state, not a hardcoded/mocked value.
 */
describe("admin: dashboard metrics", () => {
  afterAll(async () => {
    await cleanupPaymentTestData();
    await cleanupCartTestData();
    await cleanupOrderTestData();
    await cleanupInventoryTestData();
    await cleanupCatalogTestData();
  });

  describe("getOrderMetrics — orders.read", () => {
    it("super_admin and staff (both hold orders.read) can read order metrics", async () => {
      const admin = await createSuperAdminActor();
      const staff = await createStaffActor();
      await expect(getOrderMetrics(admin)).resolves.toBeDefined();
      await expect(getOrderMetrics(staff)).resolves.toBeDefined();
    });

    it("a customer (no permissions) is rejected", async () => {
      const customer = await createCustomerActor();
      await expect(getOrderMetrics(customer)).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it("reflects a real, freshly-created PAID order's revenue", async () => {
      const admin = await createSuperAdminActor();
      const customer = await createCustomerActor();
      const { variantId } = await createStockedProduct(admin, {
        quantity: 5,
        priceMinor: 77_000,
      });

      const before = await getOrderMetrics(admin);

      const { order } = await checkoutAndInitializePayment(customer, variantId);
      const attempt = await db.paymentAttempt.findFirstOrThrow({
        where: { orderId: BigInt(order.id) },
      });
      await verifyAndProcessPayment(
        attempt.id,
        createSuccessVerifyingClient(77_000),
      );

      const after = await getOrderMetrics(admin);
      expect(after.totalOrders).toBe(before.totalOrders + 1);
      expect(after.paidRevenueMinor).toBe(before.paidRevenueMinor + 77_000);
      expect(after.ordersByStatus.PAID).toBe(before.ordersByStatus.PAID + 1);
    });
  });

  describe("getPaymentMetrics — payments.read", () => {
    it("super_admin and staff (both hold payments.read) can read payment metrics", async () => {
      const admin = await createSuperAdminActor();
      const staff = await createStaffActor();
      await expect(getPaymentMetrics(admin)).resolves.toBeDefined();
      await expect(getPaymentMetrics(staff)).resolves.toBeDefined();
    });

    it("a customer is rejected", async () => {
      const customer = await createCustomerActor();
      await expect(getPaymentMetrics(customer)).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it("counts a genuinely pending attempt", async () => {
      const admin = await createSuperAdminActor();
      const customer = await createCustomerActor();
      const { variantId } = await createStockedProduct(admin, { quantity: 5 });

      const before = await getPaymentMetrics(admin);
      await checkoutAndInitializePayment(customer, variantId); // leaves a PENDING attempt
      const after = await getPaymentMetrics(admin);

      expect(after.pendingPayments).toBe(before.pendingPayments + 1);
    });
  });

  describe("getLowStockCount — inventory.read", () => {
    it("super_admin and staff (both hold inventory.read) can read the low-stock count", async () => {
      const admin = await createSuperAdminActor();
      const staff = await createStaffActor();
      await expect(getLowStockCount(admin)).resolves.toEqual(
        expect.any(Number),
      );
      await expect(getLowStockCount(staff)).resolves.toEqual(
        expect.any(Number),
      );
    });

    it("a customer is rejected", async () => {
      const customer = await createCustomerActor();
      await expect(getLowStockCount(customer)).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it("counts a variant genuinely at or below its low-stock threshold, and drops it once restocked above threshold", async () => {
      const admin = await createSuperAdminActor();
      const { variantId } = await createStockedProduct(admin, { quantity: 3 });
      await db.inventoryItem.update({
        where: { productVariantId: variantId },
        data: { lowStockThreshold: 10 },
      });

      const whileLow = await getLowStockCount(admin);

      await restockInventory(admin, variantId, { quantity: 50 });
      const afterRestock = await getLowStockCount(admin);
      expect(afterRestock).toBe(whileLow - 1);
    });
  });

  describe("getProductCount — products.read", () => {
    it("super_admin and staff (both hold products.read) can read the product count", async () => {
      const admin = await createSuperAdminActor();
      const staff = await createStaffActor();
      await expect(getProductCount(admin)).resolves.toEqual(expect.any(Number));
      await expect(getProductCount(staff)).resolves.toEqual(expect.any(Number));
    });

    it("a customer is rejected", async () => {
      const customer = await createCustomerActor();
      await expect(getProductCount(customer)).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it("increases only once the product is published — matches the public-visibility definition exactly", async () => {
      const admin = await createSuperAdminActor();
      const { product } = await createStockedProduct(admin, { quantity: 1 });

      const whileDraft = await getProductCount(admin);
      await publishProduct(admin, BigInt(product.id));
      const afterPublish = await getProductCount(admin);

      expect(afterPublish).toBe(whileDraft + 1);
    });
  });

  describe("getCustomerMetrics — users.manage", () => {
    it("only super_admin (holds users.manage) can read customer metrics", async () => {
      const admin = await createSuperAdminActor();
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await expect(getCustomerMetrics(admin, since)).resolves.toBeDefined();
    });

    it("staff (lacks users.manage) is rejected", async () => {
      const staff = await createStaffActor();
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await expect(getCustomerMetrics(staff, since)).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it("a customer is rejected", async () => {
      const customer = await createCustomerActor();
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await expect(getCustomerMetrics(customer, since)).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it("counts a freshly-registered customer as both active and new", async () => {
      const admin = await createSuperAdminActor();
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const before = await getCustomerMetrics(admin, since);
      await createCustomerActor();
      const after = await getCustomerMetrics(admin, since);
      expect(after.activeCustomers).toBe(before.activeCustomers + 1);
      expect(after.newCustomers).toBe(before.newCustomers + 1);
    });

    it("does not count a customer against a window that starts after they were created", async () => {
      const admin = await createSuperAdminActor();
      await createCustomerActor();
      const farFuture = new Date(Date.now() + 60 * 60 * 1000);
      const metrics = await getCustomerMetrics(admin, farFuture);
      expect(metrics.newCustomers).toBe(0);
    });
  });
});
