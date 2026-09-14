import { expect, test } from "@playwright/test";

import { createPublishedProduct } from "../helpers/browser-fixtures";
import {
  attachFullPageScreenshot,
  expectCriticalAccessibilityBasics,
  expectNoHorizontalOverflow,
  expectNoSeriousConsoleErrors,
} from "../helpers/browser-quality";

test.describe("browser: storefront customer journey", () => {
  test("home → shop → product → cart works through the rendered UI", async ({
    page,
  }, testInfo) => {
    const { product } = await createPublishedProduct(page.request);
    const stopConsoleCapture = await expectNoSeriousConsoleErrors(page);

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Reliable energy",
    );
    await page.getByRole("link", { name: /Shop solar products/i }).click();
    await expect(page).toHaveURL(/\/products/);

    const productLink = page
      .getByRole("link", { name: new RegExp(product.name) })
      .first();
    await expect(productLink).toBeVisible();
    await productLink.click();
    await expect(
      page.getByRole("heading", { level: 1, name: product.name }),
    ).toBeVisible();
    await expect(page.getByText("In stock")).toBeVisible();

    await page.getByRole("button", { name: "Add to cart" }).click();
    await expect(page.getByText("Added to cart.")).toBeVisible();
    await page.goto("/cart");
    await expect(page.getByText(product.name)).toBeVisible();
    await expect(page.getByRole("link", { name: /checkout/i })).toBeVisible();

    await expectCriticalAccessibilityBasics(page);
    await expectNoHorizontalOverflow(page);
    await attachFullPageScreenshot(page, testInfo, "storefront-cart");
    expect(stopConsoleCapture()).toEqual([]);
  });

  test("checkout refuses empty delivery data in the browser before calling the server", async ({
    page,
  }) => {
    const { product } = await createPublishedProduct(page.request);
    await page.goto(`/products/${product.slug}`);
    await page.getByRole("button", { name: "Add to cart" }).click();
    await expect(page.getByText("Added to cart.")).toBeVisible();

    await page.goto("/checkout");
    await expect(
      page.getByRole("heading", { level: 1, name: "Complete your order" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Continue to secure payment" })
      .click();

    await expect(
      page.getByText("Email is required for guest checkout."),
    ).toBeVisible();
    await expect(page.getByLabel("Full name")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page).toHaveURL(/\/checkout$/);
  });
});
