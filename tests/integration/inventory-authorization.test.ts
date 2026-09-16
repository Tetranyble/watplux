import { afterAll, describe, expect, it } from "vitest";

import { adjustInventory } from "@/src/modules/inventory/use-cases/adjust-inventory";
import { getInventoryForVariant } from "@/src/modules/inventory/use-cases/get-inventory-for-variant";
import { getInventoryMovementHistory } from "@/src/modules/inventory/use-cases/get-inventory-movement-history";
import { listInventory } from "@/src/modules/inventory/use-cases/list-inventory";
import { recordInventoryReturn } from "@/src/modules/inventory/use-cases/record-inventory-return";
import { restockInventory } from "@/src/modules/inventory/use-cases/restock-inventory";
import {
  cleanupCatalogTestData,
  createCustomerActor,
  createStaffActor,
  createSuperAdminActor,
  createTestProduct,
} from "./helpers/catalog-fixtures";
import { cleanupInventoryTestData } from "./helpers/inventory-fixtures";

/**
 * Authorization matrix for `inventory.read`/`inventory.adjust`
 * (docs/PHASE_5_INVENTORY_PLAN.md §10) — mirrors the pattern established
 * in `catalog-authorization.test.ts`. Per `prisma/seed-data.ts`: `staff`
 * has `inventory.read` only; `super_admin` has everything; `customer` has
 * neither. Only these two permissions are ever checked — never a role
 * name (docs/PHASE_3_AUTH_RBAC_PLAN.md convention).
 */
describe("inventory: authorization", () => {
  afterAll(async () => {
    await cleanupInventoryTestData();
    await cleanupCatalogTestData();
  });

  it("a customer (zero permissions) cannot read inventory balances or history", async () => {
    const admin = await createSuperAdminActor();
    const customer = await createCustomerActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 10 });

    await expect(
      getInventoryForVariant(customer, variantId),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      listInventory(customer, { limit: 20, lowStockOnly: false }),
    ).rejects.toMatchObject({ statusCode: 403 });

    const balance = await getInventoryForVariant(admin, variantId);
    await expect(
      getInventoryMovementHistory(customer, BigInt(balance.id), { limit: 20 }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("a customer cannot restock, adjust, or record a return", async () => {
    const admin = await createSuperAdminActor();
    const customer = await createCustomerActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);

    await expect(
      restockInventory(customer, variantId, { quantity: 10 }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      adjustInventory(customer, variantId, { delta: 5, note: "Hacked" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      recordInventoryReturn(customer, variantId, { quantity: 1 }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("a staff actor (inventory.read only) can read but cannot restock, adjust, or record a return", async () => {
    const admin = await createSuperAdminActor();
    const staff = await createStaffActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);
    await restockInventory(admin, variantId, { quantity: 10 });

    await expect(
      getInventoryForVariant(staff, variantId),
    ).resolves.toMatchObject({ quantityOnHand: 10 });
    await expect(
      listInventory(staff, { limit: 20, lowStockOnly: false }),
    ).resolves.toBeDefined();

    await expect(
      restockInventory(staff, variantId, { quantity: 5 }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      adjustInventory(staff, variantId, { delta: 5, note: "Should fail" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      recordInventoryReturn(staff, variantId, { quantity: 1 }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("a super_admin actor (inventory.read + inventory.adjust) can perform every operation", async () => {
    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);

    await expect(
      restockInventory(admin, variantId, { quantity: 10 }),
    ).resolves.toMatchObject({ type: "RESTOCK" });
    await expect(
      adjustInventory(admin, variantId, { delta: 2, note: "Correction" }),
    ).resolves.toMatchObject({ type: "ADJUSTMENT" });
    await expect(
      recordInventoryReturn(admin, variantId, { quantity: 1 }),
    ).resolves.toMatchObject({ type: "RETURN" });
    await expect(
      getInventoryForVariant(admin, variantId),
    ).resolves.toMatchObject({ quantityOnHand: 13 });
  });

  it("a forged actor-shaped object with an empty permission set cannot substitute for a real session-resolved AuthenticatedUser", async () => {
    // Same demonstration as catalog-authorization.test.ts: the ONLY
    // authorization input any inventory use-case trusts is the
    // `permissions` set on the actor object itself — there is no
    // secondary field (role name, id, email) it additionally trusts, and
    // this is never reachable over real HTTP (the Route Handler always
    // resolves `actor` via `requireSessionUser()`).
    const forgedActor = {
      id: BigInt(999_999_999),
      email: "forged@example.test",
      name: "Forged Admin",
      image: null,
      status: "ACTIVE" as const,
      permissions: new Set<string>(),
    };

    const admin = await createSuperAdminActor();
    const product = await createTestProduct(admin);
    const variantId = BigInt(product.variants[0]!.id);

    await expect(
      restockInventory(forgedActor, variantId, { quantity: 10 }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      getInventoryForVariant(forgedActor, variantId),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
