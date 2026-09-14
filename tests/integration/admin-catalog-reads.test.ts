import { afterAll, describe, expect, it } from "vitest";

import { deactivateBrand } from "@/src/modules/catalog/use-cases/deactivate-brand";
import { deactivateCategory } from "@/src/modules/catalog/use-cases/deactivate-category";
import { getCategoryTree } from "@/src/modules/catalog/use-cases/get-category-tree";
import { getCategoryTreeForAdmin } from "@/src/modules/catalog/use-cases/get-category-tree-for-admin";
import { listBrands } from "@/src/modules/catalog/use-cases/list-brands";
import { listBrandsForAdmin } from "@/src/modules/catalog/use-cases/list-brands-for-admin";
import {
  cleanupCatalogTestData,
  createCustomerActor,
  createStaffActor,
  createSuperAdminActor,
  createTestBrand,
  createTestCategory,
} from "./helpers/catalog-fixtures";

/**
 * docs/PHASE_10_ADMIN_PLAN.md §10/§28.4 — the two small additive
 * admin-only reads (`getCategoryTreeForAdmin`/`listBrandsForAdmin`),
 * each just `requirePermission` + the existing repo call with
 * `publicOnly=false`. The one thing worth proving here that no prior
 * test does: an inactive brand/category is INVISIBLE to the public
 * use-case but VISIBLE to the admin one.
 */
describe("admin: catalog additive reads", () => {
  afterAll(cleanupCatalogTestData);

  describe("getCategoryTreeForAdmin — products.read", () => {
    it("super_admin and staff (both hold products.read) can call it", async () => {
      const admin = await createSuperAdminActor();
      const staff = await createStaffActor();
      await expect(getCategoryTreeForAdmin(admin)).resolves.toBeDefined();
      await expect(getCategoryTreeForAdmin(staff)).resolves.toBeDefined();
    });

    it("a customer (no products.read) is rejected", async () => {
      const customer = await createCustomerActor();
      await expect(getCategoryTreeForAdmin(customer)).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it("includes an inactive category that the public tree omits", async () => {
      const admin = await createSuperAdminActor();
      const category = await createTestCategory(admin);
      await deactivateCategory(admin, BigInt(category.id));

      const publicTree = await getCategoryTree();
      const adminTree = await getCategoryTreeForAdmin(admin);

      function findId(nodes: typeof adminTree, id: string): boolean {
        return nodes.some((n) => n.id === id || findId(n.children, id));
      }

      expect(findId(publicTree, category.id)).toBe(false);
      expect(findId(adminTree, category.id)).toBe(true);
    });
  });

  describe("listBrandsForAdmin — products.read", () => {
    it("super_admin and staff (both hold products.read) can call it", async () => {
      const admin = await createSuperAdminActor();
      const staff = await createStaffActor();
      await expect(listBrandsForAdmin(admin)).resolves.toBeDefined();
      await expect(listBrandsForAdmin(staff)).resolves.toBeDefined();
    });

    it("a customer (no products.read) is rejected", async () => {
      const customer = await createCustomerActor();
      await expect(listBrandsForAdmin(customer)).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it("includes an inactive brand that the public list omits", async () => {
      const admin = await createSuperAdminActor();
      const brand = await createTestBrand(admin);
      await deactivateBrand(admin, BigInt(brand.id));

      const publicBrands = await listBrands();
      const adminBrands = await listBrandsForAdmin(admin);

      expect(publicBrands.map((b) => b.id)).not.toContain(brand.id);
      expect(adminBrands.map((b) => b.id)).toContain(brand.id);
    });
  });
});
