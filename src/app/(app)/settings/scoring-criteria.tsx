"use client";

import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CRITERION_IMPORTANCE, IMPORTANCE_LABELS, MAX_CRITERIA, type CriterionImportance, type ScoringCriterion } from "@/lib/scoring/criteria";

import { saveScoringCriteria } from "./actions";

const blank = (): ScoringCriterion => ({ id: crypto.randomUUID().slice(0, 12), label: "", preference: "", importance: "IMPORTANT" });

/**
 * What the user wants from a job (salary, place, company size, ...), each
 * with how much it counts. Both scorers weigh them; Save keeps the list.
 */
export function ScoringCriteria({ initial }: { initial: ScoringCriterion[] }) {
  const track = useTrackSave();
  const [criteria, setCriteria] = useState(initial);
  const [dirty, setDirty] = useState(false);

  const update = (id: string, patch: Partial<ScoringCriterion>) => {
    setDirty(true);
    setCriteria((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  };
  const remove = (id: string) => {
    setDirty(true);
    setCriteria((current) => current.filter((entry) => entry.id !== id));
  };
  const add = () => {
    setDirty(true);
    setCriteria((current) => [...current, blank()]);
  };
  const save = async () => {
    const filled = criteria.filter((entry) => entry.label.trim() && entry.preference.trim());
    const result = toastResult(await track(saveScoringCriteria({ criteria: filled })));
    if (!result.ok) return;
    setCriteria(result.data);
    setDirty(false);
  };

  return (
    <Card padding="none" className="flex flex-col gap-4 px-7 py-[26px]">
      <div className="flex flex-col gap-1">
        <h3 className="text-field font-medium">What you want from a job</h3>
        <p className="text-meta text-muted">
          Salary, place, company size or anything else, with how much it counts. A posting that misses a must-have scores below 50; Find jobs and the job agent both use these.
        </p>
      </div>
      {criteria.map((criterion, index) => (
        <div key={criterion.id} className="grid grid-cols-1 items-end gap-x-4 gap-y-3 sm:grid-cols-[1fr_2fr_auto_auto]">
          <Input
            label={`Criterion ${index + 1}`}
            value={criterion.label}
            placeholder="e.g. Salary"
            onChange={(event) => update(criterion.id, { label: event.target.value })}
          />
          <Input
            label="What you want"
            value={criterion.preference}
            placeholder="e.g. At least 80k EUR a year"
            onChange={(event) => update(criterion.id, { preference: event.target.value })}
          />
          <Select label="Counts as" value={criterion.importance} onChange={(event) => update(criterion.id, { importance: event.target.value as CriterionImportance })}>
            {CRITERION_IMPORTANCE.map((importance) => (
              <option key={importance} value={importance}>
                {IMPORTANCE_LABELS[importance]}
              </option>
            ))}
          </Select>
          <Button variant="text" size="sm" onClick={() => remove(criterion.id)} aria-label={`Remove criterion ${index + 1}`}>
            Remove
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2.5">
        <Button variant="secondary" size="sm" disabled={criteria.length >= MAX_CRITERIA} onClick={add}>
          Add a criterion
        </Button>
        <Button size="sm" disabled={!dirty} onClick={() => void save()}>
          Save criteria
        </Button>
      </div>
    </Card>
  );
}
