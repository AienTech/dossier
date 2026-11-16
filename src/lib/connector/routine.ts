import "server-only";
import { z } from "zod";
import { Creativity, LanguageLevel, Tone } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { fieldsFromBasics } from "@/lib/profile";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { agentQuerySchema } from "@/lib/agent/query";
import { findOrCreateSkill } from "@/lib/profile-entries";

const text = (n: number) => z.string().trim().max(n);
export const basicsPatch = z.strictObject({ name: text(200).optional(), headline: text(300).optional(), email: text(320).optional(), phone: text(60).optional(), dob: z.union([z.literal(""), z.iso.date()]).optional(), website: text(500).optional(), address: text(300).optional(), city: text(120).optional(), country: text(120).optional(), linkedin: text(500).optional(), summary: text(5000).optional(), showAge: z.boolean().optional() });
export async function editBasics(input: z.infer<typeof basicsPatch>) {
  const profile = await loadProfile();
  const fields = fieldsFromBasics({ ...profile.basics, ...basicsPatch.parse(input) });
  await prisma.$transaction(Object.entries(fields).map(([key, value]) => value === null ? prisma.profileField.deleteMany({ where: { key } }) : prisma.profileField.upsert({ where: { key }, create: { key, value }, update: { value } })));
}
const span = { startYear: z.number().int().min(1900).max(2200).nullable().optional(), startMonth: z.number().int().min(1).max(12).nullable().optional(), endYear: z.number().int().min(1900).max(2200).nullable().optional(), endMonth: z.number().int().min(1).max(12).nullable().optional(), current: z.boolean().optional() };
export const entryPatch = z.discriminatedUnion("section", [
  z.strictObject({ section: z.literal("experience"), id: text(100).optional(), role: text(300), company: text(300), location: text(300).optional(), descriptor: text(600).optional(), bullets: text(12000), ...span }),
  z.strictObject({ section: z.literal("project"), id: text(100).optional(), name: text(300), link: text(2000).optional(), bullets: text(12000), ...span }),
  z.strictObject({ section: z.literal("education"), id: text(100).optional(), degree: text(300), school: text(300), notes: text(12000).optional(), ...span }),
  z.strictObject({ section: z.literal("publication"), id: text(100).optional(), citation: text(5000), link: text(2000).optional(), onResumes: z.boolean().optional() }),
  z.strictObject({ section: z.literal("reference"), id: text(100).optional(), name: text(200), relation: text(300).optional(), company: text(300).optional(), email: text(320).optional(), phone: text(60).optional() }),
  z.strictObject({ section: z.literal("skill"), name: text(100).min(1), group: text(100).optional() }),
  z.strictObject({ section: z.literal("language"), id: text(100).optional(), name: text(100).min(1), level: z.enum(LanguageLevel) }),
  z.strictObject({ section: z.literal("fact"), id: text(100).optional(), text: text(5000).min(1) }),
]);
export async function editEntry(raw: z.infer<typeof entryPatch>) {
  const input = entryPatch.parse(raw);
  if (input.section === "skill") return findOrCreateSkill(input.name, input.group ?? "");
  const { section, id, ...data } = input;
  // Explicit delegates keep unknown model names and fields out of Prisma.
  switch (section) {
    case "experience": return id ? prisma.experience.update({ where: { id }, data }) : prisma.experience.create({ data: data as Parameters<typeof prisma.experience.create>[0]["data"] });
    case "project": return id ? prisma.project.update({ where: { id }, data }) : prisma.project.create({ data: data as Parameters<typeof prisma.project.create>[0]["data"] });
    case "education": return id ? prisma.education.update({ where: { id }, data }) : prisma.education.create({ data: data as Parameters<typeof prisma.education.create>[0]["data"] });
    case "publication": return id ? prisma.publication.update({ where: { id }, data }) : prisma.publication.create({ data: data as Parameters<typeof prisma.publication.create>[0]["data"] });
    case "reference": return id ? prisma.reference.update({ where: { id }, data }) : prisma.reference.create({ data: data as Parameters<typeof prisma.reference.create>[0]["data"] });
    case "language": return id ? prisma.language.update({ where: { id }, data }) : prisma.language.create({ data: data as Parameters<typeof prisma.language.create>[0]["data"] });
    case "fact": return id ? prisma.fact.update({ where: { id, applicationId: null }, data }) : prisma.fact.create({ data: data as Parameters<typeof prisma.fact.create>[0]["data"] });
  }
}
// Credential destinations, provider switches, security, backup retention and
// connector access are intentionally not editable through this allowlist.
export const settingsPatch = z.strictObject({
  model: text(200).min(1).optional(), strict: z.boolean().optional(), showDiff: z.boolean().optional(), creativity: z.enum(Creativity).optional(),
  defaultTone: z.enum(Tone).optional(), docLanguage: text(60).nullable().optional(), resumeLanguage: text(60).nullable().optional(), fileNamePattern: text(200).optional(), includeRefs: z.boolean().optional(), pageLimit: z.enum(["1", "2", "none"]).optional(),
  agentQuery: agentQuerySchema.optional(), agentEnabled: z.boolean().optional(), agentHour: z.number().int().min(0).max(23).optional(), agentAutoDraft: z.boolean().optional(), agentMinScore: z.number().int().min(0).max(100).optional(),
});
export async function publicSettings() {
  const settings = await loadSettings();
  return Object.fromEntries(Object.keys(settingsPatch.shape).map(key => [key, settings[key as keyof typeof settings]]));
}
export async function editSettings(input: z.infer<typeof settingsPatch>) { await saveSettings(settingsPatch.parse(input)); }
