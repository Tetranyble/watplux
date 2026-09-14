import { expect, test } from "@playwright/test";

import {
  PASSWORD,
  phase16Email,
  promoteToSuperAdmin,
} from "../helpers/browser-fixtures";
import {
  expectCriticalAccessibilityBasics,
  expectNoHorizontalOverflow,
} from "../helpers/browser-quality";

test.describe("browser: operations workspace", () => {
  test("super admin can authenticate and navigate the operations UI", async ({
    page,
  }) => {
    const email = phase16Email("admin");
    await page.request.post("/api/auth/sign-up/email", {
      data: { email, password: PASSWORD, name: "Phase 16 Admin" },
    });
    await promoteToSuperAdmin(email);
    await page.request.post("/api/auth/sign-in/email", {
      data: { email, password: PASSWORD },
    });

    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { level: 1, name: "Dashboard" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Catalog" }).first().click();
    await expect(page).toHaveURL(/\/admin\/catalog\/products/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await expectCriticalAccessibilityBasics(page);
    await expectNoHorizontalOverflow(page);
  });
});
