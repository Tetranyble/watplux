import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

/**
 * Playwright's `request`-fixture tests hit real HTTP endpoints, so unlike
 * tests/integration/helpers/fixtures.ts's `cleanupTestData()` (called
 * in-process via `afterAll`), there's no in-test hook to clean up after
 * them — the app under test and the test runner are separate processes.
 * This runs once after the whole suite, deleting every user this file's
 * tests created (matched by email prefix), so the e2e run leaves the
 * database exactly as clean as the integration suite does.
 *
 * Deliberately does NOT import the app's `lib/db` singleton: that module
 * imports `@/lib/env` via the `@/*` tsconfig path alias, which Playwright's
 * globalTeardown loader (a plain Node/CJS `require`, unlike vitest's
 * Vite-resolved setup files — see tests/integration/setup.ts) doesn't
 * resolve. A standalone `PrismaClient` here avoids that entirely.
 */
export default async function globalTeardown(): Promise<void> {
  config();
  const db = new PrismaClient();

  // Phase 16 cleanup guardrail: remove audit rows authored by ANY E2E test
  // identity before the phase-specific entity cleanup begins. `audit_logs`
  // intentionally has no actor FK/cascade, so relying on user deletion leaves
  // durable test residue. This generic sweep covers old and new phases and
  // replaces the fragile assumption that every spec remembers every actor log.
  const allE2eUsers = await db.user.findMany({
    where: {
      OR: [
        { email: { contains: "-e2e-" } },
        { email: { startsWith: "phase16-browser-" } },
      ],
    },
    select: { id: true },
  });
  const allE2eUserIds = allE2eUsers.map((user) => user.id);
  if (allE2eUserIds.length > 0) {
    await db.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: allE2eUserIds } },
          { entityType: "user", entityId: { in: allE2eUserIds } },
        ],
      },
    });
  }

  const testUsers = await db.user.findMany({
    where: { email: { startsWith: "phase3-e2e-" } },
    select: { id: true },
  });
  const testUserIds = testUsers.map((u) => u.id);

  if (testUserIds.length > 0) {
    // audit_logs.entityId is deliberately not a real FK
    // (docs/DATABASE_DESIGN.md §15), so it isn't cascade-deleted with the
    // user — clean it up explicitly first, same as the integration helper.
    await db.auditLog.deleteMany({
      where: { entityType: "user", entityId: { in: testUserIds } },
    });
  }

  await db.user.deleteMany({
    where: { email: { startsWith: "phase3-e2e-" } },
  });

  // Catalog e2e test data (tests/e2e/catalog.spec.ts) — matched by the
  // `Phase4E2E` name prefix, same convention as the integration suite's
  // `Phase4Test` prefix (tests/integration/helpers/catalog-fixtures.ts).
  // Also removes the `phase4-e2e-` admin/customer users it creates
  // directly (not through the phase3-e2e- prefix above).
  const testProducts = await db.product.findMany({
    where: { name: { startsWith: "Phase4E2E" } },
    select: { id: true },
  });
  const testProductIds = testProducts.map((p) => p.id);
  if (testProductIds.length > 0) {
    await db.productVariant.deleteMany({
      where: { productId: { in: testProductIds } },
    });
    await db.product.deleteMany({ where: { id: { in: testProductIds } } });
  }
  await db.category.deleteMany({
    where: { name: { startsWith: "Phase4E2E" } },
  });
  await db.brand.deleteMany({ where: { name: { startsWith: "Phase4E2E" } } });

  const catalogTestUsers = await db.user.findMany({
    where: { email: { startsWith: "phase4-e2e-" } },
    select: { id: true },
  });
  const catalogTestUserIds = catalogTestUsers.map((u) => u.id);
  if (catalogTestUserIds.length > 0) {
    await db.auditLog.deleteMany({
      where: { entityType: "user", entityId: { in: catalogTestUserIds } },
    });
  }
  await db.user.deleteMany({ where: { email: { startsWith: "phase4-e2e-" } } });

  // Inventory e2e test data (tests/e2e/inventory.spec.ts) — matched by
  // the `Phase5E2E` name prefix. `inventory_items`/`inventory_movements`
  // must be removed BEFORE their product/variant
  // (`inventory_items.product_variant_id` is `onDelete: Restrict`).
  const inventoryTestProducts = await db.product.findMany({
    where: { name: { startsWith: "Phase5E2E" } },
    select: { id: true, variants: { select: { id: true } } },
  });
  const inventoryTestVariantIds = inventoryTestProducts.flatMap((p) =>
    p.variants.map((v) => v.id),
  );
  if (inventoryTestVariantIds.length > 0) {
    const inventoryItems = await db.inventoryItem.findMany({
      where: { productVariantId: { in: inventoryTestVariantIds } },
      select: { id: true },
    });
    const inventoryItemIds = inventoryItems.map((i) => i.id);
    if (inventoryItemIds.length > 0) {
      await db.inventoryMovement.deleteMany({
        where: { inventoryItemId: { in: inventoryItemIds } },
      });
      await db.inventoryItem.deleteMany({
        where: { id: { in: inventoryItemIds } },
      });
    }
  }
  const inventoryTestProductIds = inventoryTestProducts.map((p) => p.id);
  if (inventoryTestProductIds.length > 0) {
    await db.productVariant.deleteMany({
      where: { productId: { in: inventoryTestProductIds } },
    });
    await db.product.deleteMany({
      where: { id: { in: inventoryTestProductIds } },
    });
  }
  await db.category.deleteMany({
    where: { name: { startsWith: "Phase5E2E" } },
  });

  const inventoryTestUsers = await db.user.findMany({
    where: { email: { startsWith: "phase5-e2e-" } },
    select: { id: true },
  });
  const inventoryTestUserIds = inventoryTestUsers.map((u) => u.id);
  if (inventoryTestUserIds.length > 0) {
    await db.auditLog.deleteMany({
      where: { entityType: "user", entityId: { in: inventoryTestUserIds } },
    });
    await db.auditLog.deleteMany({
      where: {
        entityType: "inventory_item",
        actorId: { in: inventoryTestUserIds },
      },
    });
  }
  await db.user.deleteMany({ where: { email: { startsWith: "phase5-e2e-" } } });

  // Order e2e test data (tests/e2e/order.spec.ts) — matched by the
  // `Phase6E2E` name prefix, found transitively via `order_items.product`
  // (order numbers are randomly generated, so there is no order-level
  // prefix to match against directly — see src/modules/order/order-number.ts).
  // `payment_attempts`/`inventory_movements` referencing these orders'
  // `order_items` must be removed first (both FKs are `ON DELETE RESTRICT`);
  // `order_items`/`order_addresses`/`order_status_history` cascade
  // automatically once the `orders` row itself is deleted.
  const orderTestOrders = await db.order.findMany({
    where: {
      items: { some: { product: { name: { startsWith: "Phase6E2E" } } } },
    },
    select: { id: true, items: { select: { id: true } } },
  });
  const orderTestOrderIds = orderTestOrders.map((o) => o.id);
  const orderTestOrderItemIds = orderTestOrders.flatMap((o) =>
    o.items.map((i) => i.id),
  );
  if (orderTestOrderItemIds.length > 0) {
    await db.inventoryMovement.deleteMany({
      where: { orderItemId: { in: orderTestOrderItemIds } },
    });
  }
  if (orderTestOrderIds.length > 0) {
    await db.order.updateMany({
      where: { id: { in: orderTestOrderIds } },
      data: { authoritativePaymentAttemptId: null },
    });
    await db.paymentAttempt.deleteMany({
      where: { orderId: { in: orderTestOrderIds } },
    });
    await db.order.deleteMany({ where: { id: { in: orderTestOrderIds } } });
  }

  const orderTestProducts = await db.product.findMany({
    where: { name: { startsWith: "Phase6E2E" } },
    select: { id: true, variants: { select: { id: true } } },
  });
  const orderTestVariantIds = orderTestProducts.flatMap((p) =>
    p.variants.map((v) => v.id),
  );
  if (orderTestVariantIds.length > 0) {
    const orderTestInventoryItems = await db.inventoryItem.findMany({
      where: { productVariantId: { in: orderTestVariantIds } },
      select: { id: true },
    });
    const orderTestInventoryItemIds = orderTestInventoryItems.map((i) => i.id);
    if (orderTestInventoryItemIds.length > 0) {
      await db.inventoryMovement.deleteMany({
        where: { inventoryItemId: { in: orderTestInventoryItemIds } },
      });
      await db.inventoryItem.deleteMany({
        where: { id: { in: orderTestInventoryItemIds } },
      });
    }
  }
  const orderTestProductIds = orderTestProducts.map((p) => p.id);
  if (orderTestProductIds.length > 0) {
    await db.productVariant.deleteMany({
      where: { productId: { in: orderTestProductIds } },
    });
    await db.product.deleteMany({ where: { id: { in: orderTestProductIds } } });
  }
  await db.category.deleteMany({
    where: { name: { startsWith: "Phase6E2E" } },
  });

  const orderTestUsers = await db.user.findMany({
    where: { email: { startsWith: "phase6-e2e-" } },
    select: { id: true },
  });
  const orderTestUserIds = orderTestUsers.map((u) => u.id);
  if (orderTestUserIds.length > 0) {
    await db.auditLog.deleteMany({
      where: { entityType: "user", entityId: { in: orderTestUserIds } },
    });
  }
  await db.user.deleteMany({ where: { email: { startsWith: "phase6-e2e-" } } });

  // Cart/Checkout e2e test data (tests/e2e/cart-checkout.spec.ts) —
  // matched by the `Phase7E2E` product-name prefix, found transitively
  // via `cart_items -> product_variants -> products`: guest carts have
  // no email/name prefix of their own to match against directly (the
  // same challenge Phase 6's order-number-based matching already
  // solved). Carts (and their cascading `cart_items`) must be removed
  // BEFORE the users they reference (`carts.userId` is `ON DELETE
  // RESTRICT`).
  const phase7Carts = await db.cart.findMany({
    where: {
      items: {
        some: {
          productVariant: { product: { name: { startsWith: "Phase7E2E" } } },
        },
      },
    },
    select: { id: true },
  });
  const phase7CartIds = phase7Carts.map((c) => c.id);
  if (phase7CartIds.length > 0) {
    // `cart_items` cascades automatically once the `carts` row is deleted.
    await db.cart.deleteMany({ where: { id: { in: phase7CartIds } } });
  }

  // Orders created during Phase 7 checkout e2e tests — same transitive
  // product-name-prefix matching Phase 6 established.
  const phase7Orders = await db.order.findMany({
    where: {
      items: { some: { product: { name: { startsWith: "Phase7E2E" } } } },
    },
    select: { id: true, items: { select: { id: true } } },
  });
  const phase7OrderIds = phase7Orders.map((o) => o.id);
  const phase7OrderItemIds = phase7Orders.flatMap((o) =>
    o.items.map((i) => i.id),
  );
  if (phase7OrderItemIds.length > 0) {
    await db.inventoryMovement.deleteMany({
      where: { orderItemId: { in: phase7OrderItemIds } },
    });
  }
  if (phase7OrderIds.length > 0) {
    await db.order.updateMany({
      where: { id: { in: phase7OrderIds } },
      data: { authoritativePaymentAttemptId: null },
    });
    await db.paymentAttempt.deleteMany({
      where: { orderId: { in: phase7OrderIds } },
    });
    await db.order.deleteMany({ where: { id: { in: phase7OrderIds } } });
  }

  const phase7Products = await db.product.findMany({
    where: { name: { startsWith: "Phase7E2E" } },
    select: { id: true, variants: { select: { id: true } } },
  });
  const phase7VariantIds = phase7Products.flatMap((p) =>
    p.variants.map((v) => v.id),
  );
  if (phase7VariantIds.length > 0) {
    const phase7InventoryItems = await db.inventoryItem.findMany({
      where: { productVariantId: { in: phase7VariantIds } },
      select: { id: true },
    });
    const phase7InventoryItemIds = phase7InventoryItems.map((i) => i.id);
    if (phase7InventoryItemIds.length > 0) {
      await db.inventoryMovement.deleteMany({
        where: { inventoryItemId: { in: phase7InventoryItemIds } },
      });
      await db.inventoryItem.deleteMany({
        where: { id: { in: phase7InventoryItemIds } },
      });
    }
  }
  const phase7ProductIds = phase7Products.map((p) => p.id);
  if (phase7ProductIds.length > 0) {
    await db.productVariant.deleteMany({
      where: { productId: { in: phase7ProductIds } },
    });
    await db.product.deleteMany({ where: { id: { in: phase7ProductIds } } });
  }
  await db.category.deleteMany({
    where: { name: { startsWith: "Phase7E2E" } },
  });

  const phase7Users = await db.user.findMany({
    where: { email: { startsWith: "phase7-e2e-" } },
    select: { id: true },
  });
  const phase7UserIds = phase7Users.map((u) => u.id);
  if (phase7UserIds.length > 0) {
    await db.auditLog.deleteMany({
      where: { entityType: "user", entityId: { in: phase7UserIds } },
    });
  }
  await db.user.deleteMany({ where: { email: { startsWith: "phase7-e2e-" } } });

  // Payment/Checkout e2e test data (tests/e2e/payment.spec.ts) — matched
  // by the `Phase8E2E` product-name prefix, same transitive-matching
  // approach as Phase 6/7. This file's tests never reach a real Paystack
  // call (no PAYSTACK_SECRET_KEY is configured in this environment) and
  // its refund/webhook-worker tests are rejected by auth before creating
  // any row, so there are no `refunds`/`webhook_events` rows to clean up
  // here — only carts, payment_attempts, and orders, in that FK order
  // (`refunds`/`webhook_events` have `ON DELETE RESTRICT` into
  // `payment_attempts`, same as the integration suite's
  // `cleanupPaymentTestData`).
  const phase8Carts = await db.cart.findMany({
    where: {
      items: {
        some: {
          productVariant: { product: { name: { startsWith: "Phase8E2E" } } },
        },
      },
    },
    select: { id: true },
  });
  const phase8CartIds = phase8Carts.map((c) => c.id);
  if (phase8CartIds.length > 0) {
    await db.cart.deleteMany({ where: { id: { in: phase8CartIds } } });
  }

  const phase8Orders = await db.order.findMany({
    where: {
      items: { some: { product: { name: { startsWith: "Phase8E2E" } } } },
    },
    select: { id: true, items: { select: { id: true } } },
  });
  const phase8OrderIds = phase8Orders.map((o) => o.id);
  const phase8OrderItemIds = phase8Orders.flatMap((o) =>
    o.items.map((i) => i.id),
  );
  if (phase8OrderItemIds.length > 0) {
    await db.inventoryMovement.deleteMany({
      where: { orderItemId: { in: phase8OrderItemIds } },
    });
  }
  if (phase8OrderIds.length > 0) {
    await db.order.updateMany({
      where: { id: { in: phase8OrderIds } },
      data: { authoritativePaymentAttemptId: null },
    });
    await db.refund.deleteMany({
      where: { paymentAttempt: { orderId: { in: phase8OrderIds } } },
    });
    await db.webhookEvent.deleteMany({
      where: { resolvedPaymentAttempt: { orderId: { in: phase8OrderIds } } },
    });
    await db.paymentAttempt.deleteMany({
      where: { orderId: { in: phase8OrderIds } },
    });
    await db.order.deleteMany({ where: { id: { in: phase8OrderIds } } });
  }

  const phase8Products = await db.product.findMany({
    where: { name: { startsWith: "Phase8E2E" } },
    select: { id: true, variants: { select: { id: true } } },
  });
  const phase8VariantIds = phase8Products.flatMap((p) =>
    p.variants.map((v) => v.id),
  );
  if (phase8VariantIds.length > 0) {
    const phase8InventoryItems = await db.inventoryItem.findMany({
      where: { productVariantId: { in: phase8VariantIds } },
      select: { id: true },
    });
    const phase8InventoryItemIds = phase8InventoryItems.map((i) => i.id);
    if (phase8InventoryItemIds.length > 0) {
      await db.inventoryMovement.deleteMany({
        where: { inventoryItemId: { in: phase8InventoryItemIds } },
      });
      await db.inventoryItem.deleteMany({
        where: { id: { in: phase8InventoryItemIds } },
      });
    }
  }
  const phase8ProductIds = phase8Products.map((p) => p.id);
  if (phase8ProductIds.length > 0) {
    await db.productVariant.deleteMany({
      where: { productId: { in: phase8ProductIds } },
    });
    await db.product.deleteMany({ where: { id: { in: phase8ProductIds } } });
  }
  await db.category.deleteMany({
    where: { name: { startsWith: "Phase8E2E" } },
  });

  const phase8Users = await db.user.findMany({
    where: { email: { startsWith: "phase8-e2e-" } },
    select: { id: true },
  });
  const phase8UserIds = phase8Users.map((u) => u.id);
  if (phase8UserIds.length > 0) {
    await db.auditLog.deleteMany({
      where: { entityType: "user", entityId: { in: phase8UserIds } },
    });
  }
  await db.user.deleteMany({ where: { email: { startsWith: "phase8-e2e-" } } });

  // Storefront e2e test data (tests/e2e/storefront.spec.ts) — matched by
  // the `Phase9E2E` product-name prefix, identical FK-order approach to
  // Phase 8's own block above (this file's tests also complete real
  // checkouts, so the same webhook_events/refunds/payment_attempts
  // ordering applies).
  const phase9Carts = await db.cart.findMany({
    where: {
      items: {
        some: {
          productVariant: { product: { name: { startsWith: "Phase9E2E" } } },
        },
      },
    },
    select: { id: true },
  });
  const phase9CartIds = phase9Carts.map((c) => c.id);
  if (phase9CartIds.length > 0) {
    await db.cart.deleteMany({ where: { id: { in: phase9CartIds } } });
  }

  const phase9Orders = await db.order.findMany({
    where: {
      items: { some: { product: { name: { startsWith: "Phase9E2E" } } } },
    },
    select: { id: true, items: { select: { id: true } } },
  });
  const phase9OrderIds = phase9Orders.map((o) => o.id);
  const phase9OrderItemIds = phase9Orders.flatMap((o) =>
    o.items.map((i) => i.id),
  );
  if (phase9OrderItemIds.length > 0) {
    await db.inventoryMovement.deleteMany({
      where: { orderItemId: { in: phase9OrderItemIds } },
    });
  }
  if (phase9OrderIds.length > 0) {
    await db.order.updateMany({
      where: { id: { in: phase9OrderIds } },
      data: { authoritativePaymentAttemptId: null },
    });
    await db.refund.deleteMany({
      where: { paymentAttempt: { orderId: { in: phase9OrderIds } } },
    });
    await db.webhookEvent.deleteMany({
      where: { resolvedPaymentAttempt: { orderId: { in: phase9OrderIds } } },
    });
    await db.paymentAttempt.deleteMany({
      where: { orderId: { in: phase9OrderIds } },
    });
    await db.order.deleteMany({ where: { id: { in: phase9OrderIds } } });
  }

  const phase9Products = await db.product.findMany({
    where: { name: { startsWith: "Phase9E2E" } },
    select: { id: true, variants: { select: { id: true } } },
  });
  const phase9VariantIds = phase9Products.flatMap((p) =>
    p.variants.map((v) => v.id),
  );
  if (phase9VariantIds.length > 0) {
    const phase9InventoryItems = await db.inventoryItem.findMany({
      where: { productVariantId: { in: phase9VariantIds } },
      select: { id: true },
    });
    const phase9InventoryItemIds = phase9InventoryItems.map((i) => i.id);
    if (phase9InventoryItemIds.length > 0) {
      await db.inventoryMovement.deleteMany({
        where: { inventoryItemId: { in: phase9InventoryItemIds } },
      });
      await db.inventoryItem.deleteMany({
        where: { id: { in: phase9InventoryItemIds } },
      });
    }
  }
  const phase9ProductIds = phase9Products.map((p) => p.id);
  if (phase9ProductIds.length > 0) {
    await db.productVariant.deleteMany({
      where: { productId: { in: phase9ProductIds } },
    });
    await db.product.deleteMany({ where: { id: { in: phase9ProductIds } } });
  }
  await db.category.deleteMany({
    where: { name: { startsWith: "Phase9E2E" } },
  });

  const phase9Users = await db.user.findMany({
    where: { email: { startsWith: "phase9-e2e-" } },
    select: { id: true },
  });
  const phase9UserIds = phase9Users.map((u) => u.id);
  if (phase9UserIds.length > 0) {
    // Defensive superset of the item-matched cart cleanup above:
    // `carts.user_id` is `ON DELETE RESTRICT` (docs/DATABASE_DESIGN.md's
    // documented MySQL-1215 deviation), so ANY cart still owned by a
    // phase9-e2e- user — even one left with zero items by a mutation
    // this file's own tests performed — would otherwise block the user
    // delete below.
    await db.cart.deleteMany({ where: { userId: { in: phase9UserIds } } });
    await db.auditLog.deleteMany({
      where: { entityType: "user", entityId: { in: phase9UserIds } },
    });
  }
  await db.user.deleteMany({ where: { email: { startsWith: "phase9-e2e-" } } });

  // A guest cart that has an item added then removed (e.g. this file's
  // own "add, update, remove" test) is left as a real, empty, ACTIVE row
  // with no `userId` — invisible to every item-matched cart query above
  // (there's nothing left to match through) and to every prior phase's
  // e2e cleanup for the same structural reason, discovered via a direct
  // post-suite database check during Phase 9 (docs/PHASE_9_STOREFRONT_IMPLEMENTATION.md
  // "bugs discovered and fixed"). Safe to sweep unconditionally here:
  // this script only ever runs against the e2e test database, never a
  // real deployment, so there is no legitimate empty guest cart it could
  // wrongly discard.
  await db.cart.deleteMany({ where: { userId: null, items: { none: {} } } });

  // Admin operations dashboard e2e test data (tests/e2e/admin.spec.ts,
  // docs/PHASE_10_ADMIN_IMPLEMENTATION.md) — matched by the `Phase10E2E`
  // product/category/brand name prefix and `phase10-e2e-` user-email
  // prefix, identical FK-order approach to Phase 9's own block above.
  // No refunds/webhook_events are ever created (every refund/webhook
  // route this file exercises is rejected by auth before touching the
  // DB — Paystack isn't configured in this environment), so unlike
  // Phase 8/9 there's nothing to clean up there.
  const phase10Orders = await db.order.findMany({
    where: {
      items: { some: { product: { name: { startsWith: "Phase10E2E" } } } },
    },
    select: { id: true, items: { select: { id: true } } },
  });
  const phase10OrderIds = phase10Orders.map((o) => o.id);
  const phase10OrderItemIds = phase10Orders.flatMap((o) =>
    o.items.map((i) => i.id),
  );
  if (phase10OrderItemIds.length > 0) {
    await db.inventoryMovement.deleteMany({
      where: { orderItemId: { in: phase10OrderItemIds } },
    });
  }
  if (phase10OrderIds.length > 0) {
    await db.order.updateMany({
      where: { id: { in: phase10OrderIds } },
      data: { authoritativePaymentAttemptId: null },
    });
    await db.paymentAttempt.deleteMany({
      where: { orderId: { in: phase10OrderIds } },
    });
    await db.order.deleteMany({ where: { id: { in: phase10OrderIds } } });
  }

  const phase10Products = await db.product.findMany({
    where: { name: { startsWith: "Phase10E2E" } },
    select: { id: true, variants: { select: { id: true } } },
  });
  const phase10VariantIds = phase10Products.flatMap((p) =>
    p.variants.map((v) => v.id),
  );
  if (phase10VariantIds.length > 0) {
    const phase10InventoryItems = await db.inventoryItem.findMany({
      where: { productVariantId: { in: phase10VariantIds } },
      select: { id: true },
    });
    const phase10InventoryItemIds = phase10InventoryItems.map((i) => i.id);
    if (phase10InventoryItemIds.length > 0) {
      await db.inventoryMovement.deleteMany({
        where: { inventoryItemId: { in: phase10InventoryItemIds } },
      });
      await db.inventoryItem.deleteMany({
        where: { id: { in: phase10InventoryItemIds } },
      });
    }
  }
  const phase10ProductIds = phase10Products.map((p) => p.id);
  if (phase10ProductIds.length > 0) {
    // `product_images`/`product_specifications` both cascade automatically
    // once the `products` row is deleted (both `onDelete: Cascade`),
    // matching every prior phase's cleanup convention.
    await db.productVariant.deleteMany({
      where: { productId: { in: phase10ProductIds } },
    });
    await db.product.deleteMany({ where: { id: { in: phase10ProductIds } } });
  }
  await db.category.deleteMany({
    where: { name: { startsWith: "Phase10E2E" } },
  });
  await db.brand.deleteMany({ where: { name: { startsWith: "Phase10E2E" } } });

  const phase10Users = await db.user.findMany({
    where: { email: { startsWith: "phase10-e2e-" } },
    select: { id: true },
  });
  const phase10UserIds = phase10Users.map((u) => u.id);
  if (phase10UserIds.length > 0) {
    await db.cart.deleteMany({ where: { userId: { in: phase10UserIds } } });
    await db.auditLog.deleteMany({
      where: { entityType: "user", entityId: { in: phase10UserIds } },
    });
  }
  await db.user.deleteMany({
    where: { email: { startsWith: "phase10-e2e-" } },
  });

  // Phase 16 rendered-browser fixtures. Guest carts are found by the product
  // prefix because they intentionally have no user identity. Remove carts and
  // inventory first to respect the same Restrict FKs as earlier phase cleanup.
  const phase16Products = await db.product.findMany({
    where: { name: { startsWith: "Phase16Browser" } },
    select: { id: true, variants: { select: { id: true } } },
  });
  const phase16ProductIds = phase16Products.map((product) => product.id);
  const phase16VariantIds = phase16Products.flatMap((product) =>
    product.variants.map((variant) => variant.id),
  );

  if (phase16VariantIds.length > 0) {
    const carts = await db.cart.findMany({
      where: {
        items: { some: { productVariantId: { in: phase16VariantIds } } },
      },
      select: { id: true },
    });
    if (carts.length > 0) {
      await db.cart.deleteMany({
        where: { id: { in: carts.map((cart) => cart.id) } },
      });
    }

    const inventoryItems = await db.inventoryItem.findMany({
      where: { productVariantId: { in: phase16VariantIds } },
      select: { id: true },
    });
    const inventoryItemIds = inventoryItems.map((item) => item.id);
    if (inventoryItemIds.length > 0) {
      await db.inventoryMovement.deleteMany({
        where: { inventoryItemId: { in: inventoryItemIds } },
      });
      await db.inventoryItem.deleteMany({
        where: { id: { in: inventoryItemIds } },
      });
    }
  }

  if (phase16ProductIds.length > 0) {
    await db.productVariant.deleteMany({
      where: { productId: { in: phase16ProductIds } },
    });
    await db.product.deleteMany({ where: { id: { in: phase16ProductIds } } });
  }
  await db.category.deleteMany({
    where: { name: { startsWith: "Phase16Browser" } },
  });

  const phase16Users = await db.user.findMany({
    where: { email: { startsWith: "phase16-browser-" } },
    select: { id: true },
  });
  const phase16UserIds = phase16Users.map((user) => user.id);
  if (phase16UserIds.length > 0) {
    await db.cart.deleteMany({ where: { userId: { in: phase16UserIds } } });
    await db.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: phase16UserIds } },
          { entityType: "user", entityId: { in: phase16UserIds } },
        ],
      },
    });
  }
  await db.user.deleteMany({
    where: { email: { startsWith: "phase16-browser-" } },
  });

  await db.$disconnect();
}
