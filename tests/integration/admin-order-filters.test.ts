import { afterAll, describe, expect, it } from "vitest";

import { listOrdersForAdmin } from "@/src/modules/order/use-cases/list-orders-for-admin";
import {
  cleanupCatalogTestData,
  createCustomerActor,
  createStaffActor,
  createSuperAdminActor,
} from "./helpers/catalog-fixtures";
import { cleanupInventoryTestData } from "./helpers/inventory-fixtures";
import {
  cleanupOrderTestData,
  createStockedProduct,
  createTestOrder,
} from "./helpers/order-fixtures";

/**
 * docs/PHASE_10_ADMIN_PLAN.md §12/§28.5 — the small additive
 * date-range/order-number/customer-email filter extension to
 * `listOrdersForAdmin`. Separate from `order-authorization.test.ts`
 * (which already covers the base authorization matrix) so this file
 * can focus on filter *correctness*, including the
 * `AND`-array silent-overwrite regression (see repo.ts comment) —
 * a customer-email search must survive pagination across pages.
 */
describe("order: admin list filters (Phase 10 additive extension)", () => {
  afterAll(async () => {
    await cleanupOrderTestData();
    await cleanupInventoryTestData();
    await cleanupCatalogTestData();
  });

  it("requires orders.read — a customer is rejected even with filters supplied", async () => {
    const customer = await createCustomerActor();
    await expect(
      listOrdersForAdmin(customer, {
        limit: 20,
        customerEmail: "someone@example.com",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("staff (holds orders.read) can use every new filter", async () => {
    const staff = await createStaffActor();
    await expect(
      listOrdersForAdmin(staff, { limit: 20, orderNumber: "x" }),
    ).resolves.toBeDefined();
  });

  it("filters by orderNumber substring", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const order = await createTestOrder(admin, variantId, {
      guestEmail: "phase10-ordernum@example.com",
    });

    const page = await listOrdersForAdmin(admin, {
      limit: 50,
      orderNumber: order.orderNumber,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.id).toBe(order.id);
  });

  it("filters by guest customerEmail", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const uniqueEmail = `phase10-guest-${Date.now()}@example.com`;
    const order = await createTestOrder(null, variantId, {
      guestEmail: uniqueEmail,
    });

    const page = await listOrdersForAdmin(admin, {
      limit: 50,
      customerEmail: uniqueEmail,
    });

    expect(page.items.map((o) => o.id)).toContain(order.id);
    expect(page.items.every((o) => o.id === order.id)).toBe(true);
  });

  it("filters by registered customer's email via the user relation", async () => {
    const admin = await createSuperAdminActor();
    const customer = await createCustomerActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const order = await createTestOrder(customer, variantId);

    const page = await listOrdersForAdmin(admin, {
      limit: 50,
      customerEmail: customer.email,
    });

    expect(page.items.some((o) => o.id === order.id)).toBe(true);
  });

  it("filters by date range (dateFrom/dateTo), excluding orders outside the window", async () => {
    const admin = await createSuperAdminActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const order = await createTestOrder(admin, variantId, {
      guestEmail: "phase10-daterange@example.com",
    });

    const farFuture = new Date(Date.now() + 60 * 60 * 1000);
    const inWindow = await listOrdersForAdmin(admin, {
      limit: 50,
      dateFrom: new Date(Date.now() - 60 * 60 * 1000),
      dateTo: farFuture,
    });
    expect(inWindow.items.some((o) => o.id === order.id)).toBe(true);

    const outOfWindow = await listOrdersForAdmin(admin, {
      limit: 50,
      dateFrom: farFuture,
    });
    expect(outOfWindow.items.some((o) => o.id === order.id)).toBe(false);
  });

  it("rejects dateFrom after dateTo at the schema layer", async () => {
    const { listOrdersForAdminSchema } =
      await import("@/src/modules/order/schema");
    const result = listOrdersForAdminSchema.safeParse({
      limit: 20,
      dateFrom: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      dateTo: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it("preserves the customerEmail filter across cursor pagination (the AND-array regression)", async () => {
    const admin = await createSuperAdminActor();
    const uniqueEmail = `phase10-paginated-${Date.now()}@example.com`;
    const { variantId: v1 } = await createStockedProduct(admin, {
      quantity: 5,
    });
    const { variantId: v2 } = await createStockedProduct(admin, {
      quantity: 5,
    });
    const { variantId: v3 } = await createStockedProduct(admin, {
      quantity: 5,
    });
    const orderA = await createTestOrder(null, v1, {
      guestEmail: uniqueEmail,
    });
    // A decoy order with a DIFFERENT email, created in between, to prove
    // the second page doesn't silently drop the email filter and start
    // returning unrelated orders once the cursor `OR` and the
    // customerEmail `OR` are both active simultaneously.
    await createTestOrder(null, v2, {
      guestEmail: "phase10-decoy@example.com",
    });
    const orderB = await createTestOrder(null, v3, {
      guestEmail: uniqueEmail,
    });

    const firstPage = await listOrdersForAdmin(admin, {
      limit: 1,
      customerEmail: uniqueEmail,
    });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0]!.id).toBe(orderB.id);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await listOrdersForAdmin(admin, {
      limit: 1,
      customerEmail: uniqueEmail,
      cursor: firstPage.nextCursor!,
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]!.id).toBe(orderA.id);
  });
});
