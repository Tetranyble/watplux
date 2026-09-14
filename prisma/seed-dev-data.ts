/**
 * Sample business data for LOCAL MANUAL TESTING ONLY — a handful of
 * realistic products/categories/brands/inventory/orders, created through
 * the real use-cases (never raw SQL, so every invariant — default variant,
 * primary image, inventory ledger — is exercised exactly like production
 * traffic would). This is deliberately NOT part of `prisma/seed.ts`/
 * `npm run db:seed`: seeding structural RBAC data (and, optionally, one
 * bootstrap admin account — see seed-admin.ts) is safe to run against any
 * environment including a fresh production database; fabricated catalog
 * and order rows are not, and must stay an explicit, separate, opt-in
 * script (`npm run db:seed:dev`) that a real deployment would never invoke.
 *
 * Requires `SEED_ADMIN_EMAIL` to already exist (run `npm run db:seed`
 * first) — this script acts AS that admin, through the same
 * `requirePermission`-gated use-cases the admin UI itself calls, so it
 * proves the seeded data is reachable through the app exactly as written,
 * not a shortcut around it.
 */
import { PrismaClient } from "@prisma/client";

import { env } from "@/lib/env";
import { hashPassword } from "@/src/integrations/crypto/password";
import * as authRepo from "@/src/modules/auth/repo";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { addProductImage } from "@/src/modules/catalog/use-cases/add-product-image";
import { createBrand } from "@/src/modules/catalog/use-cases/create-brand";
import { createCategory } from "@/src/modules/catalog/use-cases/create-category";
import { createProduct } from "@/src/modules/catalog/use-cases/create-product";
import { publishProduct } from "@/src/modules/catalog/use-cases/publish-product";
import { upsertProductSpecification } from "@/src/modules/catalog/use-cases/upsert-product-specification";
import { restockInventory } from "@/src/modules/inventory/use-cases/restock-inventory";
import { cancelOrder } from "@/src/modules/order/use-cases/cancel-order";
import { createOrder } from "@/src/modules/order/use-cases/create-order";
import { PERMISSIONS } from "./seed-data";

const db = new PrismaClient();

const CUSTOMER_EMAIL = "customer@example.test";
const CUSTOMER_PASSWORD = "CustomerPass123!";

async function getAdminActor(): Promise<AuthenticatedUser> {
  if (!env.SEED_ADMIN_EMAIL) {
    throw new Error(
      "SEED_ADMIN_EMAIL is not set. Set SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD and run `npm run db:seed` before seeding sample data.",
    );
  }
  const user = await authRepo.findUserByEmail(env.SEED_ADMIN_EMAIL);
  if (!user) {
    throw new Error(
      `No user found for SEED_ADMIN_EMAIL=${env.SEED_ADMIN_EMAIL} — run \`npm run db:seed\` first.`,
    );
  }
  // Every permission, matching what the seeded super_admin role actually
  // resolves to — not re-derived via a real login, since this script has
  // no HTTP session to create one from.
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    permissions: new Set(PERMISSIONS),
  };
}

async function getOrCreateCustomerActor(): Promise<AuthenticatedUser> {
  let user = await authRepo.findUserByEmail(CUSTOMER_EMAIL);
  if (!user) {
    const passwordHash = await hashPassword(CUSTOMER_PASSWORD);
    user = await authRepo.createUserWithCustomerRole({
      email: CUSTOMER_EMAIL,
      passwordHash,
      name: "Sample Customer",
    });
    console.log(
      `Created sample customer account: ${CUSTOMER_EMAIL} / ${CUSTOMER_PASSWORD}`,
    );
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    permissions: new Set(),
  };
}

const SHIPPING_ADDRESS = {
  fullName: "Sample Customer",
  phone: "+2348012345678",
  addressLine1: "1 Solar Way",
  city: "Lagos",
  state: "Lagos",
  country: "NG",
};

const MARKER_SKU = "SEED-SP-400W";

async function main(): Promise<void> {
  // Unlike categories/brands/products (whose slugs auto-suffix on
  // collision, per docs/PHASE_4_CATALOG_PLAN.md §11), `ProductVariant.sku`
  // is globally unique with no such fallback — a second run would
  // otherwise fail hallway through with a raw `ConflictError` stack trace
  // instead of a clear message. This script is meant to run once against
  // an empty/fresh dataset; re-running is a safe no-op, not an error.
  const existing = await db.productVariant.findUnique({
    where: { sku: MARKER_SKU },
  });
  if (existing) {
    console.log(
      `Sample data already exists (found SKU ${MARKER_SKU}) — nothing to do. Delete the seeded rows yourself first if you want to reseed.`,
    );
    return;
  }

  const admin = await getAdminActor();
  const customer = await getOrCreateCustomerActor();

  const solarPanels = await createCategory(admin, {
    name: "Solar Panels",
    isActive: true,
  });
  const portablePanels = await createCategory(admin, {
    name: "Portable Panels",
    parentId: BigInt(solarPanels.id),
    isActive: true,
  });
  const inverters = await createCategory(admin, {
    name: "Inverters",
    isActive: true,
  });
  const batteries = await createCategory(admin, {
    name: "Batteries",
    isActive: true,
  });

  const sunpower = await createBrand(admin, { name: "SunPower" });
  const growatt = await createBrand(admin, { name: "Growatt" });

  // 1. Published, well-stocked panel.
  const panel400 = await createProduct(admin, {
    name: "SunPower 400W Monocrystalline Panel",
    shortDescription: "High-efficiency monocrystalline solar panel.",
    unitOfMeasure: "EACH",
    categoryId: BigInt(solarPanels.id),
    brandId: BigInt(sunpower.id),
    isFeatured: true,
    variant: {
      sku: "SEED-SP-400W",
      priceMinor: 25_000_000,
      powerRatingW: 400,
      voltageV: 24,
      weightKg: 22.5,
    },
  });
  await addProductImage(admin, {
    productId: BigInt(panel400.id),
    url: "https://images.example.test/sunpower-400w.jpg",
    altText: "SunPower 400W solar panel",
  });
  await upsertProductSpecification(admin, {
    productId: BigInt(panel400.id),
    specKey: "cell_type",
    specValue: "Monocrystalline",
  });
  await upsertProductSpecification(admin, {
    productId: BigInt(panel400.id),
    specKey: "warranty_terms",
    specValue: "25-year performance warranty",
  });
  await restockInventory(admin, BigInt(panel400.variants[0]!.id), {
    quantity: 50,
  });
  await publishProduct(admin, BigInt(panel400.id));

  // 2. Published, LOW-STOCK portable panel — demonstrates the dashboard's
  // low-stock count and the inventory list's low-stock badge.
  const panel100 = await createProduct(admin, {
    name: "SunPower 100W Portable Panel",
    shortDescription: "Foldable panel for off-grid and camping use.",
    unitOfMeasure: "EACH",
    categoryId: BigInt(portablePanels.id),
    brandId: BigInt(sunpower.id),
    isFeatured: false,
    variant: {
      sku: "SEED-SP-100W",
      priceMinor: 8_500_000,
      powerRatingW: 100,
    },
  });
  await restockInventory(admin, BigInt(panel100.variants[0]!.id), {
    quantity: 3,
  });
  // `lowStockThreshold` has no use-case of its own anywhere in the
  // codebase (confirmed during Phase 10) — set directly, same as the
  // integration suite's own `admin-dashboard-metrics.test.ts` does.
  await db.inventoryItem.update({
    where: { productVariantId: BigInt(panel100.variants[0]!.id) },
    data: { lowStockThreshold: 5 },
  });
  await publishProduct(admin, BigInt(panel100.id));

  // 3. Published inverter.
  const inverter5kw = await createProduct(admin, {
    name: "Growatt 5kW Hybrid Inverter",
    shortDescription: "Hybrid inverter for grid-tied or off-grid systems.",
    unitOfMeasure: "EACH",
    categoryId: BigInt(inverters.id),
    brandId: BigInt(growatt.id),
    isFeatured: true,
    variant: {
      sku: "SEED-GW-5KW",
      priceMinor: 45_000_000,
      powerRatingW: 5000,
      phase: "SINGLE",
    },
  });
  await restockInventory(admin, BigInt(inverter5kw.variants[0]!.id), {
    quantity: 15,
  });
  await publishProduct(admin, BigInt(inverter5kw.id));

  // 4. Published battery.
  const battery200ah = await createProduct(admin, {
    name: "Growatt 200Ah Lithium Battery",
    shortDescription: "LiFePO4 battery for solar energy storage.",
    unitOfMeasure: "EACH",
    categoryId: BigInt(batteries.id),
    brandId: BigInt(growatt.id),
    isFeatured: false,
    variant: {
      sku: "SEED-GW-200AH",
      priceMinor: 60_000_000,
      capacityWh: 2560,
    },
  });
  await restockInventory(admin, BigInt(battery200ah.variants[0]!.id), {
    quantity: 8,
  });
  await publishProduct(admin, BigInt(battery200ah.id));

  // 5. DRAFT, never restocked — shows the "not yet stocked" inventory
  // state and a non-ACTIVE row in the product list.
  await createProduct(admin, {
    name: "SunPower 550W Bifacial Panel",
    shortDescription: "Bifacial panel, not yet published.",
    unitOfMeasure: "EACH",
    categoryId: BigInt(solarPanels.id),
    brandId: BigInt(sunpower.id),
    isFeatured: false,
    variant: {
      sku: "SEED-SP-550W",
      priceMinor: 32_000_000,
      powerRatingW: 550,
    },
  });

  // Two sample orders as the sample customer — one left PENDING_PAYMENT,
  // one cancelled, so both order-list filters and status variety have
  // something real to show.
  const orderA = await createOrder(customer, {
    lines: [{ variantId: BigInt(panel400.variants[0]!.id), quantity: 2 }],
    shippingAddress: SHIPPING_ADDRESS,
  });
  console.log(`Created order ${orderA.orderNumber} (PENDING_PAYMENT).`);

  const orderB = await createOrder(customer, {
    lines: [{ variantId: BigInt(inverter5kw.variants[0]!.id), quantity: 1 }],
    shippingAddress: SHIPPING_ADDRESS,
  });
  await cancelOrder(customer, BigInt(orderB.id), {
    note: "Sample cancelled order for admin testing.",
  });
  console.log(`Created and cancelled order ${orderB.orderNumber}.`);

  console.log("Sample data seeded:");
  console.log(
    "  4 categories (1 nested), 2 brands, 5 products (4 published, 1 draft)",
  );
  console.log("  1 low-stock variant (SunPower 100W, 3 on hand / threshold 5)");
  console.log("  2 orders (1 pending payment, 1 cancelled)");
  console.log(`  Log in as ${env.SEED_ADMIN_EMAIL} to view them in /admin.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
