import { expect, test, type Page } from "@playwright/test";

import { sql } from "./support";

// The README's screenshots (see playwright.readme.config.ts): each screen as the
// demo data shows it, 1440×900 at 2×, saved over .github/images/*.png.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

const IMAGES = ".github/images";

const POSTING = `Ledgerly: Senior Product Designer, Payments
Amsterdam (hybrid, 3 days in office) · €75,000–€90,000

What we're looking for
- 5+ years of product design
- You've built or maintained a design system
- Strong prototyping skills in Figma
- Experience with Kubernetes
- Dutch is a plus`;

/** Fonts loaded and nothing left to fetch, so no screenshot catches a fallback font. */
async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${IMAGES}/${name}.png` });
}

test("the dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening), Jane/ })).toBeVisible();
  await shot(page, "dashboard");
});

test("the profile", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.getByLabel("Full name")).toHaveValue("Jane Doe");
  await shot(page, "profile");
});

test("the base resume with its themes", async ({ page }) => {
  await page.goto("/resume");
  await expect(page.getByRole("button", { name: "Editorial theme, in use" })).toBeVisible();
  await shot(page, "resume");
});

test("Find jobs with a posting open", async ({ page }) => {
  await page.goto("/jobs");
  await page.getByRole("search", { name: "Search postings" }).getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Senior Product Designer, Payments" })).toBeVisible();
  await shot(page, "find-jobs");
});

test("an application with its tailored resume and the chat", async ({ page }) => {
  const [ledgerly] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE company = 'Ledgerly' LIMIT 1`);
  await page.goto(`/applications/${ledgerly.id}`);
  await expect(page.getByRole("article", { name: "Resume" })).toContainText("Jane Doe");
  await expect(page.getByRole("log", { name: "Conversation" })).toContainText("Nothing invented");
  await shot(page, "application");
});

test.describe("the board", () => {
  test.use({ viewport: { width: 1680, height: 900 } });

  test("applications in progress", async ({ page }) => {
    await page.goto("/applications?filter=active");
    await expect(page.getByText("Kestrel Maps")).toBeVisible();
    await shot(page, "applications");
  });
});

// Last, since it adds an application the other screens shouldn't show.
test("a new application: how you match", async ({ page }) => {
  await page.goto("/new?fresh=1");
  await page.getByLabel("Job posting").fill(POSTING);
  await page.getByRole("button", { name: "Read the posting →" }).click();
  const match = page.getByRole("heading", { name: "How you match" });
  await expect(match).toBeVisible();
  await expect(page.getByText("Experience with Kubernetes")).toBeVisible();
  // The match card at the top, with the end of the details card above it.
  await match.evaluate((heading) => {
    heading.scrollIntoView({ block: "start" });
    window.scrollBy(0, -56);
  });
  await shot(page, "new-application");
});
