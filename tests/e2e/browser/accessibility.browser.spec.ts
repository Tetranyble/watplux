import { test } from "@playwright/test";

import {
  expectCriticalAccessibilityBasics,
  expectNoHorizontalOverflow,
} from "../helpers/browser-quality";

const publicRoutes = [
  "/",
  "/products",
  "/login",
  "/register",
  "/consultation",
  "/installation",
] as const;

for (const route of publicRoutes) {
  test(`critical accessibility smoke: ${route}`, async ({ page }) => {
    await page.goto(route);
    await expectCriticalAccessibilityBasics(page);
    await expectNoHorizontalOverflow(page);
  });
}
