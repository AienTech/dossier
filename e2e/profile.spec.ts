import { expect, test } from "@playwright/test";

import { resetData } from "./support";

// The profile end to end (E4): basics, skills and languages, a new role with
// a skill attached, all kept after a reload and shown on the base resume.
test.beforeAll(resetData);

test("fills in the profile, keeps it and shows it on the base resume", async ({ page }) => {
  await page.goto("/profile");
  await page.getByLabel("Full name").fill("Robin Vermeer");
  await page.getByLabel("City").fill("Utrecht");
  await page.getByLabel("City").blur();
  await expect(page.getByText("Saved just now")).toBeVisible();

  await page.getByRole("navigation", { name: "Profile sections" }).getByRole("link", { name: /Skills & languages/ }).click();
  await page.getByLabel("Add a skill").fill("Accessibility");
  await page.getByLabel("Add a skill").press("Enter");
  await expect(page.getByRole("list", { name: "Your skills" })).toContainText("Accessibility");
  await page.getByLabel("Language", { exact: true }).fill("French");
  await page.getByLabel("Language", { exact: true }).press("Enter");
  await expect(page.getByLabel("French level")).toBeVisible();

  await page.getByRole("navigation", { name: "Profile sections" }).getByRole("link", { name: /Experience/ }).click();
  await page.getByRole("button", { name: "+ Add a role" }).click();
  await expect(page.getByLabel("Role", { exact: true })).toBeFocused();
  await page.getByLabel("Role", { exact: true }).fill("Design Lead");
  await page.getByLabel("Company", { exact: true }).fill("Acme Payments");
  await page.getByLabel("What you did").fill("Led the redesign of the payout flow\nSet up the design system");
  await page.getByRole("group", { name: "Skills you used here" }).getByRole("button", { name: "Accessibility" }).click();
  await page.getByLabel("What you did").blur();
  await expect(page.getByText("Saved just now")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: /Design Lead.*Acme Payments/ })).toBeVisible();
  await page.getByRole("navigation", { name: "Profile sections" }).getByRole("link", { name: /Basics/ }).click();
  await expect(page.getByLabel("Full name")).toHaveValue("Robin Vermeer");

  await page.goto("/resume");
  const resume = page.getByRole("article", { name: "Resume" });
  await expect(resume).toContainText("Robin Vermeer");
  await expect(resume).toContainText("Acme Payments");
  await expect(resume).toContainText("Led the redesign of the payout flow");
});
