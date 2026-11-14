"use client";

import { useActionState } from "react";
import { saveProfileAction, type ProfileFormState } from "@/app/actions";
import {
  ACTIVITY_LABELS,
  GOAL_LABELS,
  type Activity,
  type Goal,
  type Profile,
  type Sex,
} from "@/lib/profile";

const INITIAL: ProfileFormState = { ok: false };

const FIELD =
  "w-full rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm outline-none focus:border-[#1f6f4a]/50 focus:ring-2 focus:ring-[#1f6f4a]/10";
const LABEL = "mb-1 block text-[10px] font-medium uppercase tracking-wide text-black/40";

/**
 * The profile form.
 *
 * Validation lives on the server (`parseProfile`) because that is where the
 * numbers become targets. The browser's `min`/`max` attributes are a
 * courtesy, not the guard.
 */
export function ProfileForm({ profile }: { profile: Profile }) {
  const [state, action, pending] = useActionState(saveProfileAction, INITIAL);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={LABEL}>Sex</span>
          <select name="sex" defaultValue={profile.sex} className={FIELD}>
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
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              name="ageYears"
              min="13"
              max="100"
              step="1"
              required
              defaultValue={profile.ageYears}
              className={FIELD}
            />
            <span className="text-xs text-black/40">years</span>
          </div>
        </label>

        <label>
          <span className={LABEL}>Height</span>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              name="heightCm"
              min="100"
              max="250"
              step="0.5"
              required
              defaultValue={profile.heightCm}
              className={FIELD}
            />
            <span className="text-xs text-black/40">cm</span>
          </div>
        </label>

        <label>
          <span className={LABEL}>Weight</span>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              name="weightKg"
              min="25"
              max="300"
              step="0.1"
              required
              defaultValue={profile.weightKg}
              className={FIELD}
            />
            <span className="text-xs text-black/40">kg</span>
          </div>
        </label>

        <label className="sm:col-span-2">
          <span className={LABEL}>Activity</span>
          <select name="activity" defaultValue={profile.activity} className={FIELD}>
            {(Object.keys(ACTIVITY_LABELS) as Activity[]).map((value) => (
              <option key={value} value={value}>
                {ACTIVITY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>

        <label className="sm:col-span-2">
          <span className={LABEL}>Goal</span>
          <select name="goal" defaultValue={profile.goal} className={FIELD}>
            {(Object.keys(GOAL_LABELS) as Goal[]).map((value) => (
              <option key={value} value={value}>
                {GOAL_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[#1f6f4a] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1a5c3d] disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save profile"}
        </button>

        {state.message && (
          <p className={`text-[11px] ${state.ok ? "text-[#1f6f4a]" : "text-red-700"}`}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
