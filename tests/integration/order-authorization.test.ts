import { afterAll, describe, expect, it } from "vitest";

import { cancelOrder } from "@/src/modules/order/use-cases/cancel-order";
import { getOrderById } from "@/src/modules/order/use-cases/get-order-by-id";
import { getOrderByOrderNumber } from "@/src/modules/order/use-cases/get-order-by-order-number";
import { getOrderForAdmin } from "@/src/modules/order/use-cases/get-order-for-admin";
import { listMyOrders } from "@/src/modules/order/use-cases/list-my-orders";
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

describe("order: authorization and IDOR", () => {
  afterAll(async () => {
    await cleanupOrderTestData();
    await cleanupInventoryTestData();
    await cleanupCatalogTestData();
  });

  it("a customer can read their own order via getOrderById and getOrderByOrderNumber", async () => {
    const admin = await createSuperAdminActor();
    const customer = await createCustomerActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const order = await createTestOrder(customer, variantId);

    const byId = await getOrderById(customer, BigInt(order.id));
    expect(byId.id).toBe(order.id);

    const byNumber = await getOrderByOrderNumber(customer, order.orderNumber);
    expect(byNumber.id).toBe(order.id);
  });

  it("customer A cannot read customer B's order (403), and a nonexistent order is 404 either way", async () => {
    const admin = await createSuperAdminActor();
    const customerA = await createCustomerActor();
    const customerB = await createCustomerActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const order = await createTestOrder(customerA, variantId);

    await expect(
      getOrderById(customerB, BigInt(order.id)),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      getOrderByOrderNumber(customerB, order.orderNumber),
    ).rejects.toMatchObject({ statusCode: 403 });

    await expect(
      getOrderById(customerB, BigInt("999999999999")),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("staff and super_admin (orders.read) can read any customer's order — the sanctioned elevated path", async () => {
    const admin = await createSuperAdminActor();
    const staff = await createStaffActor();
    const customer = await createCustomerActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const order = await createTestOrder(customer, variantId);

    const viaStaff = await getOrderById(staff, BigInt(order.id));
    expect(viaStaff.id).toBe(order.id);
    const viaAdmin = await getOrderById(admin, BigInt(order.id));
    expect(viaAdmin.id).toBe(order.id);
  });

  it("listMyOrders only ever returns the caller's own orders", async () => {
    const admin = await createSuperAdminActor();
    const customerA = await createCustomerActor();
    const customerB = await createCustomerActor();
    const { variantId: variantA } = await createStockedProduct(admin, {
      quantity: 5,
    });
    const { variantId: variantB } = await createStockedProduct(admin, {
      quantity: 5,
    });
    const orderA = await createTestOrder(customerA, variantA);
    await createTestOrder(customerB, variantB);

    const page = await listMyOrders(customerA, { limit: 50 });
    expect(page.items.every((o) => o.userId === customerA.id.toString())).toBe(
      true,
    );
    expect(page.items.some((o) => o.id === orderA.id)).toBe(true);
  });

  it("listOrdersForAdmin and getOrderForAdmin require orders.read — a customer is rejected", async () => {
    const admin = await createSuperAdminActor();
    const customer = await createCustomerActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const order = await createTestOrder(customer, variantId);

    await expect(
      listOrdersForAdmin(customer, { limit: 20 }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      getOrderForAdmin(customer, BigInt(order.id)),
    ).rejects.toMatchObject({ statusCode: 403 });

    const adminPage = await listOrdersForAdmin(admin, { limit: 50 });
    expect(adminPage.items.some((o) => o.id === order.id)).toBe(true);
    const adminDetail = await getOrderForAdmin(admin, BigInt(order.id));
    expect(adminDetail.id).toBe(order.id);
  });

  it("a customer without ownership and without orders.update cannot cancel another customer's order (full authorization matrix)", async () => {
    const admin = await createSuperAdminActor();
    const staff = await createStaffActor();
    const customerOwner = await createCustomerActor();
    const customerStranger = await createCustomerActor();
    const { variantId: v1 } = await createStockedProduct(admin, {
      quantity: 5,
    });
    const { variantId: v2 } = await createStockedProduct(admin, {
      quantity: 5,
    });
    const { variantId: v3 } = await createStockedProduct(admin, {
      quantity: 5,
    });
    const orderForStranger = await createTestOrder(customerOwner, v1);
    const orderForStaff = await createTestOrder(customerOwner, v2);
    const orderForAdmin = await createTestOrder(customerOwner, v3);

    await expect(
      cancelOrder(customerStranger, BigInt(orderForStranger.id), {}),
    ).rejects.toMatchObject({ statusCode: 403 });

    await expect(
      cancelOrder(staff, BigInt(orderForStaff.id), {}),
    ).resolves.toMatchObject({ status: "CANCELLED" });

    await expect(
      cancelOrder(admin, BigInt(orderForAdmin.id), {}),
    ).resolves.toMatchObject({ status: "CANCELLED" });
  });

  it("a forged actor-shaped object with an empty permission set cannot substitute for a real session-resolved AuthenticatedUser", async () => {
    // Same demonstration as catalog-authorization.test.ts /
    // inventory-authorization.test.ts: the ONLY authorization input any
    // order use-case trusts is the `permissions` set (and `id`, for
    // ownership) on the actor object itself.
    const admin = await createSuperAdminActor();
    const customer = await createCustomerActor();
    const { variantId } = await createStockedProduct(admin, { quantity: 5 });
    const order = await createTestOrder(customer, variantId);

    const forgedActor = {
      id: BigInt(999_999_999),
      email: "forged@example.test",
      name: "Forged Admin",
      image: null,
      status: "ACTIVE" as const,
      permissions: new Set<string>(),
    };

    await expect(
      getOrderById(forgedActor, BigInt(order.id)),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      listOrdersForAdmin(forgedActor, { limit: 20 }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      cancelOrder(forgedActor, BigInt(order.id), {}),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
