import { readFile } from "node:fs/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { resetData } from "./support";

// Managing themes (E5-7): duplicate, export, delete and import again.
test.beforeAll(resetData);

test("duplicates, exports, deletes and imports a theme", async ({ page }) => {
  await page.goto("/resume");
  const inUse = page.getByText(/^In use:/);
  const original = (await inUse.textContent())!.replace("In use: ", "");

  await page.getByRole("button", { name: `Duplicate ${original}` }).click();
  await expect(inUse).toHaveText(`In use: ${original} copy`);

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: `Export ${original} copy` }).click()]);
  const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(exported).toMatchObject({
    format: "dossier-theme",
    version: 2,
    theme: { name: `${original} copy`, headerStyle: expect.any(String), sidebarStyle: expect.any(String), dateStyle: expect.any(String) },
  });

  await page.getByRole("button", { name: `Delete ${original} copy…` }).click();
  const dialog = page.getByRole("alertdialog", { name: `Delete “${original} copy”?` });
  await expect(dialog).toContainText("No application uses it.");
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  await dialog.getByRole("button", { name: "Delete theme" }).click();
  await expect(inUse).toHaveText("In use: Editorial");
  await expect(page.getByRole("button", { name: `${original} copy theme` })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Editorial theme, in use" })).toBeFocused();

  await page.locator("input[type=file][accept*=json]").setInputFiles({
    name: "theme.dossier-theme.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(inUse).toHaveText(`In use: ${original} copy`);
  await page.reload();
  await expect(page.getByRole("button", { name: `${original} copy theme, in use` })).toBeVisible();
});
