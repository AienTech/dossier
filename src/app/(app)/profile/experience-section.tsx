"use client";

import { useId, useMemo, useState } from "react";

import { toast } from "@/components/toast";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleChip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAutosave } from "@/hooks/use-autosave";
import { formatDateRange, sameName, type EntryOrder, type ExperienceItem, type ProfileData, type SkillItem } from "@/lib/profile";

import {
  attachNewSkill,
  createExperience,
  removeExperience,
  reorderEntries,
  restoreExperience,
  saveExperience,
  setExperienceSkill,
  sortEntriesByDate,
} from "./actions";
import { EntryList } from "./entry-list";
import { MonthYearField } from "./month-year-field";
import { useTrackSave } from "@/components/save-tracker";
import type { UpdateProfile } from "./skills-section";

/** The fields of an open role, autosaved as you type. */
function ExperienceForm({
  entry,
  onChange,
  autoFocus,
}: {
  entry: ExperienceItem;
  onChange: (entry: ExperienceItem) => void;
  autoFocus: boolean;
}) {
  const track = useTrackSave();
  // Autosave the text and dates only; skill links save on their own when toggled.
  const { id, role, company, location, bullets, startYear, startMonth, endYear, endMonth, current } = entry;
  const fields = useMemo(
    () => ({ id, role, company, location, bullets, startYear, startMonth, endYear, endMonth, current }),
    [id, role, company, location, bullets, startYear, startMonth, endYear, endMonth, current],
  );
  const { flush } = useAutosave(fields, (value) => track(saveExperience(value)));
  const set = (change: Partial<ExperienceItem>) => onChange({ ...entry, ...change });

  return (
    <div className="grid grid-cols-2 gap-[18px]" onBlur={flush}>
      <Input
        className="col-span-2"
        label="Role"
        placeholder="Product Designer"
        value={entry.role}
        onChange={(event) => set({ role: event.target.value })}
        autoFocus={autoFocus}
      />
      <Input
        label="Company"
        placeholder="Acme Inc."
        value={entry.company}
        onChange={(event) => set({ company: event.target.value })}
      />
      <Input
        label="Location"
        placeholder="Springfield"
        value={entry.location}
        onChange={(event) => set({ location: event.target.value })}
      />
      <MonthYearField
        label="Started"
        value={{ month: entry.startMonth, year: entry.startYear }}
        onChange={({ month, year }) => set({ startMonth: month, startYear: year })}
      />
      <div className="flex flex-col gap-2.5">
        <MonthYearField
          label="Ended"
          value={{ month: entry.endMonth, year: entry.endYear }}
          onChange={({ month, year }) => set({ endMonth: month, endYear: year })}
          disabled={entry.current}
        />
        <Checkbox
          label="I still work here"
          checked={entry.current}
          onChange={(event) => set({ current: event.target.checked })}
        />
      </div>
      <Textarea
        className="col-span-2"
        label="What you did"
        placeholder="One point per line. Rough is fine."
        rows={4}
        value={entry.bullets}
        onChange={(event) => set({ bullets: event.target.value })}
      />
    </div>
  );
}

/**
 * "Skills you used here" (PRO-6): every profile skill as a toggle chip, and
 * an input that adds a new skill to the profile and attaches it in one step.
 */
function SkillsUsed({ entry, skills, update }: { entry: ExperienceItem; skills: SkillItem[]; update: UpdateProfile }) {
  const track = useTrackSave();
  const labelId = useId();
  const [draft, setDraft] = useState("");
  const attached = skills.filter((skill) => entry.skillIds.includes(skill.id)).length;

  const setLinks = (skillIds: string[]) =>
    update((current) => ({
      ...current,
      experience: current.experience.map((item) => (item.id === entry.id ? { ...item, skillIds } : item)),
    }));

  async function toggle(skillId: string) {
    const on = !entry.skillIds.includes(skillId);
    const before = entry.skillIds;
    setLinks(on ? [...before, skillId] : before.filter((linked) => linked !== skillId));
    const result = await track(setExperienceSkill({ experienceId: entry.id, skillId, attached: on }));
    if (!result.ok) {
      setLinks(before);
      toast(result.error);
    }
  }

  async function addNew() {
    const name = draft.trim();
    if (!name) return;
    setDraft("");
    const existing = skills.find((skill) => sameName(skill.name, name));
    if (existing) {
      if (!entry.skillIds.includes(existing.id)) await toggle(existing.id);
      return;
    }
    const result = await track(attachNewSkill({ experienceId: entry.id, name }));
    if (!result.ok) {
      setDraft(name);
      return toast(result.error);
    }
    const { skill } = result.data;
    update((current) => ({
      ...current,
      skills: current.skills.some((item) => item.id === skill.id) ? current.skills : [...current.skills, skill],
      experience: current.experience.map((item) =>
        item.id === entry.id && !item.skillIds.includes(skill.id) ? { ...item, skillIds: [...item.skillIds, skill.id] } : item,
      ),
    }));
  }

  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-2.5 pt-1">
      <div className="flex items-baseline justify-between gap-3">
        <span id={labelId} className="text-label text-muted">
          Skills you used here
        </span>
        <span className="text-xs text-muted">
          {skills.length > 0
            ? `${attached} of ${skills.length} attached`
            : "Add skills in Skills & languages, or type one below"}
        </span>
      </div>
      {skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {skills.map((skill) => (
            <ToggleChip
              key={skill.id}
              check
              selected={entry.skillIds.includes(skill.id)}
              onClick={() => void toggle(skill.id)}
            >
              {skill.name}
            </ToggleChip>
          ))}
        </div>
      )}
      <Input
        aria-label="Add a new skill to this role"
        placeholder="New skill? Type it and press Enter to add it to your profile too"
        inputClassName="py-[9px] text-control"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          void addNew();
        }}
      />
      <p className="text-label text-muted">
        The AI uses these links to show where you actually applied a skill when it tailors a resume.
      </p>
    </div>
  );
}

const roleTitle = (entry: ExperienceItem) => entry.role.trim() || "New role";

/** Work experience (PRO-5): one card open at a time, autosaved, with Undo on Remove. */
export function ExperienceSection({ profile, update, order }: { profile: ProfileData; update: UpdateProfile; order: EntryOrder }) {
  const skillNames = (entry: ExperienceItem) =>
    profile.skills.filter((skill) => entry.skillIds.includes(skill.id)).map((skill) => skill.name);

  return (
    <EntryList
      items={profile.experience}
      setItems={(change) => update((current) => ({ ...current, experience: change(current.experience) }))}
      addLabel="Add a role"
      ordering={{
        mode: order,
        save: (ids) => reorderEntries({ section: "experience", ids }),
        sortByDate: () => sortEntriesByDate({ section: "experience" }),
      }}
      summary={(entry) => ({
        title: roleTitle(entry),
        subtitle: [entry.company, entry.location].filter((part) => part.trim()).join(" · "),
        meta: formatDateRange(entry),
        footnote: skillNames(entry).join(" · ") || undefined,
      })}
      create={() => createExperience({})}
      remove={(entry) => removeExperience({ id: entry.id })}
      restore={(entry) => restoreExperience(entry)}
      renderForm={(entry, { onChange, autoFocus }) => (
        <>
          <ExperienceForm entry={entry} onChange={onChange} autoFocus={autoFocus} />
          <SkillsUsed entry={entry} skills={profile.skills} update={update} />
        </>
      )}
    />
  );
}
