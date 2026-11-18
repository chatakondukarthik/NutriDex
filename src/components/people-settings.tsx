"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  archivePersonAction,
  createPersonAction,
  deletePersonAction,
  renamePersonAction,
  switchPersonAction,
  unarchivePersonAction,
} from "@/app/actions";
import {
  ACTIVITY_LABELS,
  DEFAULT_PROFILE,
  GOAL_LABELS,
  type Activity,
  type Goal,
  type Sex,
} from "@/lib/profile";

/**
 * Settings → People.
 *
 * This is a household roster, not an account manager (D-051): everyone at the
 * device can switch to everyone, and recipes and foods are shared. The panel
 * is deliberately explicit about that so "person" is not mistaken for a
 * privacy boundary.
 *
 * Deactivating is the default way to retire someone; hard delete is separate,
 * two-step, names the counts and blocks the last person.
 */

export interface PersonSummary {
  id: string;
  displayName: string;
  archivedAt: string | null;
  counts: {
    diaryEntries: number;
    plans: number;
    planEntries: number;
    pins: number;
  };
}

const FIELD =
  "w-full rounded-control border border-line bg-surface px-2.5 py-2 text-[11px] text-ink outline-none transition placeholder:text-faint focus:border-accent/50 focus:ring-2 focus:ring-accent/10";
const LABEL = "mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink/40";

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

function summary(counts: PersonSummary["counts"]): string {
  const parts = [
    counts.diaryEntries > 0 ? `${counts.diaryEntries} diary` : null,
    counts.plans > 0 ? `${counts.plans} plan${counts.plans === 1 ? "" : "s"}` : null,
    counts.pins > 0 ? `${counts.pins} pinned` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : "No personal data yet";
}

export function PeopleSettingsPanel({
  people,
  activePersonId,
  householdName,
}: {
  people: PersonSummary[];
  activePersonId: string;
  householdName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const addFormRef = useRef<HTMLFormElement>(null);

  const activeCount = people.filter((person) => !person.archivedAt).length;
  const canDelete = (person: PersonSummary) =>
    people.length > 1 && (Boolean(person.archivedAt) || activeCount > 1);

  function run(
    action: () => Promise<{ ok: boolean; message?: string }>,
    success: string,
  ) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message ?? "That change could not be saved.");
        return;
      }
      setNotice(success);
      setEditing(null);
      setDeleting(null);
      setAcknowledged(false);
      router.refresh();
    });
  }

  function select(person: PersonSummary) {
    run(() => switchPersonAction(person.id), `Switched to ${person.displayName}.`);
  }

  function add(formData: FormData) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await createPersonAction(formData);
      if (!result.ok) {
        setError(result.message ?? "That person could not be added.");
        return;
      }
      addFormRef.current?.reset();
      setAddOpen(false);
      setNotice("Person added. They are now the active person.");
      router.refresh();
    });
  }

  function rename(person: PersonSummary) {
    const name = nameDraft.trim();
    if (!name || name === person.displayName) {
      setEditing(null);
      return;
    }
    run(() => renamePersonAction(person.id, name), `Renamed to ${name}.`);
  }

  return (
    <section
      id="people"
      aria-labelledby="people-title"
      className="scroll-mt-24 rounded-2xl border border-line bg-surface p-5 shadow-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="people-title" className="text-sm font-semibold">
          People
        </h2>
        <span className="text-[10px] text-faint">{householdName}</span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        People keep diaries, plans and body profiles apart. Profiles are not private: anyone at
        this device can switch people and see all household data. Shared foods and recipes are used
        by everyone in the household.
      </p>

      <ul className="mt-3 space-y-2">
        {people.map((person) => {
          const active = person.id === activePersonId;
          const archived = Boolean(person.archivedAt);
          const isEditing = editing === person.id;
          const isDeleting = deleting === person.id;

          return (
            <li
              key={person.id}
              className={`rounded-xl border p-3 ${
                active ? "border-accent/40 bg-accent/5" : "border-line bg-bg"
              } ${archived ? "opacity-70" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
                  {initialOf(person.displayName)}
                </span>
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <form
                      className="flex flex-wrap items-center gap-1.5"
                      onSubmit={(event) => {
                        event.preventDefault();
                        rename(person);
                      }}
                    >
                      <input
                        value={nameDraft}
                        onChange={(event) => setNameDraft(event.target.value)}
                        maxLength={60}
                        autoFocus
                        aria-label={`Name for ${person.displayName}`}
                        className={`${FIELD} max-w-56`}
                      />
                      <button
                        type="submit"
                        disabled={pending}
                        className="rounded-lg bg-accent px-2.5 py-1.5 text-[10px] font-semibold text-accent-fg transition hover:bg-accent-strong disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        disabled={pending}
                        className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[10px] font-medium text-muted transition hover:text-ink disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-ink">
                          {person.displayName}
                        </span>
                        {active && !archived && (
                          <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">
                            Active
                          </span>
                        )}
                        {archived && (
                          <span className="rounded-full bg-ink/5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted">
                            Inactive
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[10px] tabular text-faint">
                        {summary(person.counts)}
                      </p>
                    </>
                  )}
                </div>

                {!isEditing && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {!active && !archived && (
                      <button
                        type="button"
                        onClick={() => select(person)}
                        disabled={pending}
                        className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[10px] font-medium text-ink transition hover:bg-ink/5 disabled:opacity-50"
                      >
                        Switch to
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(person.id);
                        setNameDraft(person.displayName);
                        setError(null);
                      }}
                      disabled={pending}
                      className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[10px] font-medium text-muted transition hover:text-ink disabled:opacity-50"
                    >
                      Rename
                    </button>
                    {archived ? (
                      <button
                        type="button"
                        onClick={() =>
                          run(
                            () => unarchivePersonAction(person.id),
                            `Reactivated ${person.displayName}.`,
                          )
                        }
                        disabled={pending}
                        className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[10px] font-medium text-muted transition hover:text-ink disabled:opacity-50"
                      >
                        Reactivate
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          run(
                            () => archivePersonAction(person.id),
                            `Deactivated ${person.displayName}.`,
                          )
                        }
                        disabled={pending || activeCount <= 1}
                        title={activeCount <= 1 ? "The last active person cannot be deactivated." : undefined}
                        className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[10px] font-medium text-muted transition hover:text-ink disabled:opacity-50"
                      >
                        Deactivate
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setDeleting(isDeleting ? null : person.id);
                        setAcknowledged(false);
                        setError(null);
                      }}
                      disabled={pending || !canDelete(person)}
                      title={
                        canDelete(person)
                          ? undefined
                          : "Add or reactivate someone else before deleting this person."
                      }
                      className="rounded-lg border border-danger-line bg-surface px-2.5 py-1.5 text-[10px] font-medium text-danger-ink transition hover:bg-danger-soft disabled:opacity-50"
                    >
                      Delete…
                    </button>
                  </div>
                )}
              </div>

              {isDeleting && (
                <div
                  role="group"
                  aria-label={`Delete ${person.displayName}`}
                  className="mt-3 rounded-lg border border-danger-line bg-danger-soft p-3"
                >
                  <p className="text-[11px] font-semibold text-danger-ink">
                    Delete {person.displayName}?
                  </p>
                  <p className="mt-1 text-[10px] leading-relaxed text-danger-ink">
                    Removes {person.counts.diaryEntries} diary{" "}
                    {person.counts.diaryEntries === 1 ? "entry" : "entries"},{" "}
                    {person.counts.plans} {person.counts.plans === 1 ? "plan" : "plans"} (
                    {person.counts.planEntries} planned{" "}
                    {person.counts.planEntries === 1 ? "meal" : "meals"}), their body profile,
                    thresholds and {person.counts.pins} pinned{" "}
                    {person.counts.pins === 1 ? "amount" : "amounts"}. Shared recipes and foods are
                    kept. There is no undo — download an archive first if you might want it back.
                  </p>
                  <label className="mt-2 flex items-start gap-2 text-[11px] font-medium text-danger-ink">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(event) => setAcknowledged(event.target.checked)}
                      className="mt-0.5"
                    />
                    I understand this cannot be undone.
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (!acknowledged) return;
                        run(
                          () => deletePersonAction(person.id),
                          `Deleted ${person.displayName}.`,
                        );
                      }}
                      disabled={!acknowledged || pending}
                      className="rounded-lg bg-danger px-3 py-1.5 text-[10px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                    >
                      Delete permanently
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleting(null);
                        setAcknowledged(false);
                      }}
                      disabled={pending}
                      className="rounded-lg border border-danger-line bg-surface px-3 py-1.5 text-[10px] font-medium text-ink/70 transition hover:text-ink disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {activeCount === 1 && (
        <p className="mt-2 text-[10px] leading-relaxed text-faint">
          The last active person cannot be deactivated or deleted. Add someone else first.
        </p>
      )}

      <div className="mt-3">
        {!addOpen ? (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[11px] font-medium text-ink transition hover:bg-ink/5"
          >
            Add person
          </button>
        ) : (
          <form
            ref={addFormRef}
            action={add}
            className="rounded-xl border border-line bg-bg p-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold">Add a person</h3>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="text-[10px] text-muted underline underline-offset-2 transition hover:text-ink"
              >
                Close
              </button>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className={LABEL}>Name</span>
                <input
                  name="displayName"
                  required
                  maxLength={60}
                  placeholder="e.g. Priya"
                  className={FIELD}
                />
              </label>
              <label>
                <span className={LABEL}>Sex</span>
                <select name="sex" defaultValue={DEFAULT_PROFILE.sex} className={FIELD}>
                  {(
                    [
                      { value: "female", label: "Female" },
                      { value: "male", label: "Male" },
                    ] as { value: Sex; label: string }[]
                  ).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className={LABEL}>Age</span>
                <input
                  type="number"
                  name="ageYears"
                  min="13"
                  max="100"
                  step="1"
                  required
                  defaultValue={DEFAULT_PROFILE.ageYears}
                  className={FIELD}
                />
              </label>
              <label>
                <span className={LABEL}>Height (cm)</span>
                <input
                  type="number"
                  name="heightCm"
                  min="100"
                  max="250"
                  step="0.5"
                  required
                  defaultValue={DEFAULT_PROFILE.heightCm}
                  className={FIELD}
                />
              </label>
              <label>
                <span className={LABEL}>Weight (kg)</span>
                <input
                  type="number"
                  name="weightKg"
                  min="25"
                  max="300"
                  step="0.1"
                  required
                  defaultValue={DEFAULT_PROFILE.weightKg}
                  className={FIELD}
                />
              </label>
              <label>
                <span className={LABEL}>Activity</span>
                <select name="activity" defaultValue={DEFAULT_PROFILE.activity} className={FIELD}>
                  {(Object.keys(ACTIVITY_LABELS) as Activity[]).map((value) => (
                    <option key={value} value={value}>
                      {ACTIVITY_LABELS[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className={LABEL}>Goal</span>
                <select name="goal" defaultValue={DEFAULT_PROFILE.goal} className={FIELD}>
                  {(Object.keys(GOAL_LABELS) as Goal[]).map((value) => (
                    <option key={value} value={value}>
                      {GOAL_LABELS[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sm:col-span-2">
                <span className={LABEL}>Copy target thresholds from</span>
                <select name="copyTargetsFrom" defaultValue="" className={FIELD}>
                  <option value="">No, start with the defaults</option>
                  {people
                    .filter((person) => !person.archivedAt)
                    .map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.displayName}
                      </option>
                    ))}
                </select>
                <span className="mt-1 block text-[10px] leading-relaxed text-faint">
                  Copies status thresholds and per-nutrient overrides only, never someone
                  else&apos;s diary, plans or body profile.
                </span>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-accent px-4 py-1.5 text-[11px] font-semibold text-accent-fg transition hover:bg-accent-strong disabled:opacity-50"
              >
                {pending ? "Adding…" : "Add person"}
              </button>
              <span className="text-[10px] text-faint">
                The new person becomes active. You can change these numbers later in Profile.
              </span>
            </div>
          </form>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-[11px] text-danger-ink"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mt-3 rounded-lg border border-line bg-bg px-3 py-2 text-[11px] text-muted"
        >
          {notice}
        </p>
      )}
    </section>
  );
}
