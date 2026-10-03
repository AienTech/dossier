import { expect, test, type Page } from "@playwright/test";

import { resetData } from "./support";

// Moving applications through the pipeline (E9): dragging on the board, the
// keyboard alternative, and the table's status select.
test.beforeEach(resetData);

const column = (page: Page, name: string) =>
  page.locator("section", { has: page.getByRole("heading", { name: new RegExp(`^${name}`) }) });

test("drags a card to another column", async ({ page }) => {
  await page.goto("/applications");
  const card = column(page, "Sent").locator("li", { hasText: "Kestrel Maps" });
  const from = (await card.boundingBox())!;
  const to = (await column(page, "Screening").boundingBox())!;
  await page.mouse.move(from.x + 60, from.y + 30);
  await page.mouse.down();
  await page.mouse.move(from.x + 80, from.y + 40, { steps: 4 });
  await page.mouse.move(to.x + 120, to.y + 200, { steps: 12 });
  await page.mouse.up();

  await expect(column(page, "Screening")).toContainText("Kestrel Maps");
  await expect(page.getByText("In screening. They're taking a look.")).toBeVisible();
  await page.reload();
  await expect(column(page, "Screening")).toContainText("Kestrel Maps");
});

test("moves a card from the keyboard", async ({ page }) => {
  await page.goto("/applications");
  await page.getByRole("button", { name: /^Actions for Product Designer, Mobile, Kestrel Maps/ }).focus();
  await page.keyboard.press("Enter");
  // Radix moves focus to the first item once the menu is open.
  await expect(page.getByRole("menuitemradio").first()).toBeFocused();
  const interview = page.getByRole("menuitemradio", { name: /Interview/ });
  for (let step = 0; step < 12 && !(await interview.evaluate((item) => item === document.activeElement)); step++) {
    await page.keyboard.press("ArrowDown");
  }
  await expect(interview).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(column(page, "Interview")).toContainText("Kestrel Maps");
});

test("changes a status in the table", async ({ page }) => {
  await page.goto("/applications?view=table");
  await page.getByLabel("Status of Product Designer, Mobile, Kestrel Maps").selectOption("SCREENING");
  await expect(page.getByText("In screening. They're taking a look.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Status of Product Designer, Mobile, Kestrel Maps")).toHaveValue("SCREENING");
});
