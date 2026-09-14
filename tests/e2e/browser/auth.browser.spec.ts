import { expect, test } from "@playwright/test";

import { PASSWORD, phase16Email } from "../helpers/browser-fixtures";
import {
  expectCriticalAccessibilityBasics,
  expectNoHorizontalOverflow,
} from "../helpers/browser-quality";

test.describe("browser: authentication", () => {
  test("registration gives immediate client validation and creates a customer account", async ({
    page,
  }) => {
    await page.goto("/register");
    await expect(
      page.getByRole("heading", { level: 1, name: "Create your account" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Name is required.")).toBeVisible();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();

    const email = phase16Email("register");
    await page.getByLabel("Full name").fill("Phase 16 Customer");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/account/);
    await expect(page.getByText(email)).toBeVisible();
  });

  test("login page has a single useful page heading and exposes validation accessibly", async ({
    page,
  }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { level: 1, name: "Sign in" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByText("Password is required.")).toBeVisible();
    await expectCriticalAccessibilityBasics(page);
    await expectNoHorizontalOverflow(page);
  });
});
