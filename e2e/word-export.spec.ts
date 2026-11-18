import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { extractText } from "unpdf";

import { FIRST_PROFILE, resetData, setProfileSetting, sql } from "./support";

test.beforeEach(resetData);
test.afterAll(resetData);

const SECOND_PROFILE = "word-second-profile";
const HEADLINE = "Specialist in accessible payment systems";
const SUMMARY = "Second profile export sentinel";

async function secondProfile() {
  await sql(
    `INSERT INTO "Profile" (id, name, headline, summary, settings, "updatedAt")
     VALUES ($1, 'Payments', $2, $3, $4::jsonb, now())`,
    [SECOND_PROFILE, HEADLINE, SUMMARY, JSON.stringify({ baseThemeId: "studio", resumeLanguage: "German" })],
  );
}

function documentXml(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  expect(Object.keys(files).some((path) => path.startsWith("word/fonts/"))).toBe(true);
  return strFromU8(files["word/document.xml"]);
}

/** Preserve actual production downloads for optional desktop Word comparisons. */
async function pair(page: Page, name: string, query: string, word?: Uint8Array) {
  const response = await page.request.get(`/api/pdf?${query}`);
  expect(response.ok()).toBe(true);
  const pdf = await response.body();
  const docx = word ?? await (async () => {
    const response = await page.request.get(`/api/docx?${query}`);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("wordprocessingml.document");
    return response.body();
  })();
  if (process.env.WORD_PARITY_OUTPUT) {
    for (const folder of ["docx", "chromium"]) await mkdir(join(process.env.WORD_PARITY_OUTPUT, folder), { recursive: true });
    await writeFile(join(process.env.WORD_PARITY_OUTPUT, "docx", `${name}.docx`), docx);
    await writeFile(join(process.env.WORD_PARITY_OUTPUT, "chromium", `${name}.pdf`), pdf);
  }
  const { text } = await extractText(new Uint8Array(pdf), { mergePages: true });
  return { xml: documentXml(docx), text };
}

async function downloadWord(page: Page) {
  await page.getByRole("button", { name: "More export options" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: /Word \(\.docx\)/ }).click(),
  ]);
  expect(await download.failure()).toBeNull();
  return readFile((await download.path())!);
}

test("downloads the selected profile, not the first or the last opened in another tab", async ({ page, context }) => {
  await secondProfile();
  await page.goto(`/resume?profile=${SECOND_PROFILE}`);
  await expect(page.getByRole("article", { name: "Resume" })).toContainText(HEADLINE);
  const other = await context.newPage();
  await other.goto("/resume");
  await other.getByRole("button", { name: "Profile: Payments" }).click();
  await other.getByRole("menuitemradio", { name: "Senior Product Designer" }).click();
  await expect(other.getByRole("article", { name: "Resume" })).toContainText("Senior Product Designer");
  const { xml, text } = await pair(page, "selected-profile", `doc=base&profile=${SECOND_PROFILE}`, await downloadWord(page));
  for (const content of [xml, text]) {
    expect(content).toContain(HEADLINE);
    expect(content).toContain(SUMMARY);
    expect(content).not.toContain("Senior Product Designer");
  }
  expect(xml).toContain('w:val="de"');
  await other.close();
});

test("exports base fitting without dropping content, and keeps PDF as the default", async ({ page }) => {
  const [{ id }] = await sql<{ id: string }>(`SELECT id FROM "Profile" WHERE id = ${FIRST_PROFILE}`);
  await page.goto(`/resume?profile=${id}`);
  await expect(page.getByRole("link", { name: "Download PDF", exact: true })).toHaveAttribute("href", `/api/pdf?doc=base&profile=${id}`);
  const normal = await pair(page, "base-fit-off", `doc=base&profile=${id}`, await downloadWord(page));
  await setProfileSetting("fitBaseResume", "true");
  await page.reload();
  const fitted = await pair(page, "base-fit-on", `doc=base&profile=${id}`, await downloadWord(page));
  for (const { xml, text } of [normal, fitted]) {
    expect(xml).toContain("Jane Doe");
    expect(text).toContain("Jane Doe");
    expect(xml).toContain("IDI-20481");
    expect(text).toContain("IDI-20481");
  }
  // The fixture spans pages at normal spacing; fitting changes geometry, not its words.
  expect(fitted.xml.match(/<w:pgMar[^>]*>/)?.[0]).not.toBe(normal.xml.match(/<w:pgMar[^>]*>/)?.[0]);
});

test("downloads tailored documents from their own profile and preserves the sent copy after edits", async ({ page }) => {
  await secondProfile();
  const [{ id }] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE company = 'Ledgerly' LIMIT 1`);
  await sql(`UPDATE "Application" SET "profileId" = $1 WHERE id = $2`, [SECOND_PROFILE, id]);
  await page.goto(`/applications/${id}?tab=resume`);
  const draft = await pair(page, "tailored-draft", `doc=resume&application=${id}`, await downloadWord(page));
  expect(draft.xml).toContain(HEADLINE);
  expect(draft.text).toContain(HEADLINE);
  await page.getByRole("tab", { name: "Cover letter", exact: true }).click();
  await pair(page, "letter-draft", `doc=letter&application=${id}`, await downloadWord(page));
  await page.getByRole("tab", { name: "Email", exact: true }).click();
  expect(await page.getByRole("button", { name: "More export options" }).count()).toBe(0);
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await page.getByRole("menuitem", { name: "By email" }).click();
  await expect(page.getByText("Marked as sent. Fingers crossed!")).toBeVisible();
  const [{ frozen }] = await sql<{ frozen: unknown }>(`SELECT frozen FROM "Application" WHERE id = $1`, [id]);
  expect(frozen).not.toBeNull();
  await sql(`UPDATE "Profile" SET headline = 'Changed after sending', settings = '{"baseThemeId":"signal"}'::jsonb WHERE id = $1`, [SECOND_PROFILE]);
  await page.goto(`/applications/${id}?tab=resume`);
  const sent = await pair(page, "tailored-sent", `doc=resume&application=${id}`, await downloadWord(page));
  expect(sent.xml).toContain(HEADLINE);
  expect(sent.text).toContain(HEADLINE);
  expect(sent.xml).not.toContain("Changed after sending");
  expect(sent.text).not.toContain("Changed after sending");
  expect(sent.xml.match(/<w:pgMar[^>]*>/)?.[0]).toBe(draft.xml.match(/<w:pgMar[^>]*>/)?.[0]);
  await page.getByRole("tab", { name: "Cover letter", exact: true }).click();
  await pair(page, "letter-sent", `doc=letter&application=${id}`, await downloadWord(page));
});
