import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageLevel } from "@/generated/prisma/enums";
import type { ImportedProfile } from "@/lib/profile-import";
import { createTestClient, resetDatabase } from "@/test/db";

import { applyImportedProfile } from "./profile-import-apply";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const prisma = () => db.client!;

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

const noDates = { startYear: null, startMonth: null, endYear: null, endMonth: null, current: false };
const imported: ImportedProfile = {
  basics: { name: "Robin Vermeer", city: "Utrecht" },
  skills: [
    { name: "figma", found: true },
    { name: "User research", found: true },
  ],
  languages: [
    { name: "dutch", level: LanguageLevel.NATIVE, levelGiven: true },
    { name: "German", level: LanguageLevel.B2, levelGiven: false },
  ],
  experience: [
    { role: "Design Lead", company: "Acme Payments", location: "", bullets: "Led the payout redesign", skills: ["User research"], startYear: 2021, startMonth: 3, endYear: null, endMonth: null, current: true, unverified: [] },
    { role: "Product designer", company: "fieldnote", location: "Amsterdam", bullets: "", skills: ["figma"], ...noDates, unverified: [] },
  ],
  education: [{ degree: "MSc Interaction Design", school: "TU Delft", notes: "", startYear: 2015, startMonth: null, endYear: 2017, endMonth: null, current: false, unverified: [] }],
  references: [{ name: "Amira Haddad", relation: "Manager", company: "", email: "amira@example.com", phone: "", unverified: [] }],
};

/** A profile with a name, email, two skills, Dutch at C1, the Fieldnote role and a reference. */
async function existingProfile() {
  await prisma().profileField.createMany({ data: [{ key: "name", value: "Robin V." }, { key: "email", value: "robin@old.example" }] });
  const figma = await prisma().skill.create({ data: { name: "Figma", sort: 0 } });
  await prisma().skill.create({ data: { name: "Prototyping", sort: 1 } });
  await prisma().language.create({ data: { name: "Dutch", level: LanguageLevel.C1, sort: 0 } });
  await prisma().experience.create({
    data: { role: "Product Designer", company: "Fieldnote", bullets: "My own bullets", startYear: 2018, sort: 0, skills: { create: [{ skillId: figma.id }] } },
  });
  await prisma().reference.create({ data: { name: "amira haddad", relation: "", company: "Fieldnote", sort: 0 } });
}

describe("applyImportedProfile (E4-10)", () => {
  it("merges: the file wins where it says something, the rest is kept and the new is added", async () => {
    await existingProfile();
    await applyImportedProfile(prisma(), imported, "merge");

    const fields = Object.fromEntries((await prisma().profileField.findMany()).map((field) => [field.key, field.value]));
    expect(fields).toEqual({ name: "Robin Vermeer", email: "robin@old.example", city: "Utrecht" });
    expect((await prisma().skill.findMany({ orderBy: { sort: "asc" } })).map((skill) => skill.name)).toEqual(["Figma", "Prototyping", "User research"]);
    expect(await prisma().language.findMany({ orderBy: { sort: "asc" }, select: { name: true, level: true } })).toEqual([
      { name: "Dutch", level: LanguageLevel.NATIVE },
      { name: "German", level: LanguageLevel.B2 },
    ]);

    const roles = await prisma().experience.findMany({ orderBy: { sort: "asc" }, include: { skills: { include: { skill: true } } } });
    // Matched regardless of case, the same role takes the file's spelling; its
    // empty bullets and missing dates keep what was there.
    expect(roles.map((role) => [role.role, role.company])).toEqual([
      ["Product designer", "fieldnote"],
      ["Design Lead", "Acme Payments"],
    ]);
    expect(roles[0]).toMatchObject({ location: "Amsterdam", bullets: "My own bullets", startYear: 2018 });
    expect(roles[0].skills.map((link) => link.skill.name)).toEqual(["Figma"]);
    expect(roles[1]).toMatchObject({ bullets: "Led the payout redesign", startYear: 2021, startMonth: 3, current: true });
    expect(roles[1].skills.map((link) => link.skill.name)).toEqual(["User research"]);

    expect(await prisma().education.count()).toBe(1);
    const references = await prisma().reference.findMany();
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({ relation: "Manager", company: "Fieldnote", email: "amira@example.com" });
  });

  it("puts new entries first in a section ordered by hand", async () => {
    await existingProfile();
    await prisma().setting.create({ data: { key: "experienceOrder", value: "manual" } });
    await applyImportedProfile(prisma(), imported, "merge");
    const roles = await prisma().experience.findMany({ orderBy: { sort: "asc" } });
    expect(roles.map((role) => role.company)).toEqual(["Acme Payments", "fieldnote"]);
  });

  it("replaces: only what the file holds, in date order", async () => {
    await existingProfile();
    await prisma().setting.create({ data: { key: "experienceOrder", value: "manual" } });
    await prisma().profileField.create({ data: { key: "showAge", value: "false" } });
    await applyImportedProfile(prisma(), imported, "replace");

    const fields = Object.fromEntries((await prisma().profileField.findMany()).map((field) => [field.key, field.value]));
    expect(fields).toEqual({ name: "Robin Vermeer", city: "Utrecht", showAge: "false" });
    expect((await prisma().skill.findMany()).map((skill) => skill.name).sort()).toEqual(["User research", "figma"]);
    expect((await prisma().experience.findMany()).map((role) => role.company).sort()).toEqual(["Acme Payments", "fieldnote"]);
    expect((await prisma().setting.findUnique({ where: { key: "experienceOrder" } }))?.value).toBe("date");
  });
});
