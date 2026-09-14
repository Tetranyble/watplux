import { expect, test } from "@playwright/test";

import {
  attachFullPageScreenshot,
  expectNoHorizontalOverflow,
} from "../helpers/browser-quality";

test("mobile storefront navigation stays usable without horizontal overflow", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expectNoHorizontalOverflow(page);

  const menu = page.getByRole("button", { name: "Open menu" });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.getByRole("navigation", { name: "Mobile" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Shop", exact: true }),
  ).toBeVisible();
  await attachFullPageScreenshot(page, testInfo, "mobile-home-menu-open");
});

test("mobile product filter layout does not overflow", async ({
  page,
}, testInfo) => {
  await page.goto("/products");
  await expect(
    page.getByRole("heading", { level: 1, name: "Shop" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await attachFullPageScreenshot(page, testInfo, "mobile-products");
});
