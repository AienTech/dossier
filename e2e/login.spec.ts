import { expect, test } from "@playwright/test";

import { PASSWORD, sql } from "./support";

// Signing in (AUTH-1, AUTH-4) and the backoff after failures (E3), signed out.
test.use({ storageState: { cookies: [], origins: [] } });

test.afterEach(async () => {
  await sql(`DELETE FROM "LoginThrottle"`);
});

test("sends a signed-out visitor to sign in, then on to where they were going", async ({ page }) => {
  await page.goto("/applications");
  await expect(page).toHaveURL("/login?next=%2Fapplications");
  await page.getByLabel("Password", { exact: true }).fill("not it");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("That's not the password set on the server. Try again.")).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/applications");
  await expect(page.getByRole("heading", { level: 1, name: "Applications" })).toBeVisible();
});

test("slows down guessing after five wrong passwords", async ({ page }) => {
  await page.goto("/login");
  const password = page.getByLabel("Password", { exact: true });
  for (let attempt = 1; attempt <= 5; attempt++) {
    await password.fill(`guess ${attempt}`);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("That's not the password set on the server. Try again.")).toBeVisible();
  }
  // Even the right password has to wait now.
  await password.fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/^Too many attempts/)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
