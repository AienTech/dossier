import { describe, expect, it } from "vitest";
import { demoProfile } from "./demo-profile";
import { resumeContent } from "./resume-content";
import { skillGroups } from "./skill-groups";
import { profileForPrompt } from "./ai/tasks/prompt-parts";
import { resumeUnits } from "./ai/tasks/tailor-resume";

describe("skill category visibility", () => {
  it("keeps Other Skills after named categories", () => {
    expect(skillGroups([{ name: "Unknown", group: "Other Skills" }, { name: "React", group: "Frameworks" }]).map((row) => row.group)).toEqual(["Frameworks", "Other Skills"]);
  });
  it("hides base skills while allowing tailoring to select and print them", () => {
    const profile = demoProfile();
    const hidden = profile.skills[0];
    profile.skills = profile.skills.map((skill) => ({ ...skill, hidden: skill.id === hidden.id }));
    expect(resumeContent(profile).skills).not.toContain(hidden.name);
    expect(profileForPrompt(profile)).toContain(hidden.name);
    const units = resumeUnits(profile, { summary: "", roles: [], projects: [], skills: [hidden.name], education: [] });
    expect(resumeContent(profile, { units }).skills).toContain(hidden.name);
    expect(profile.skills.find((skill) => skill.id === hidden.id)?.hidden).toBe(true);
  });
});
