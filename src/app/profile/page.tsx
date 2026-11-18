import { ProfileEditor } from "@/components/profile-editor";
import { getProfile } from "@/lib/db/profile";
import { getTargetRules } from "@/lib/db/settings";
import { getActivePerson } from "@/lib/person-server";
import { isDefaultProfile } from "@/lib/profile";
import { listFoods } from "@/lib/db/foods";
import { listEntries, today } from "@/lib/db/entries";
import { listRecipeOptions } from "@/lib/db/recipes";
import { addDays, weekdayShort } from "@/lib/plan";
import { dayRollup } from "@/lib/day";
import { WeekStrip } from "@/components/week-strip";
import { NUTRIENT_CODES, type Food } from "@/lib/nutrition/types";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const person = await getActivePerson();
  const profile = getProfile(person.id);

  // The ledger's honest sparkline — real kcal, per day, from the diary.
  const todayStr = today();
  const foods = listFoods();
  const allRecipes = listRecipeOptions();
  const recipeByVersion = new Map(allRecipes.map((o) => [o.versionId, o]));
  const resolveFood = (id: string): Food =>
    foods.find((f) => f.id === id) ?? {
      id,
      name: "Deleted food",
      aliases: [],
      category: "Custom",
      kind: "provisional",
      state: "raw",
      portions: [],
      nutrients: Object.fromEntries(
        NUTRIENT_CODES.map((code) => [
          code,
          { amount: null, status: "unknown", source: "none" },
        ]),
      ) as Food["nutrients"],
    };
  const week = Array.from({ length: 7 }, (_, index) => addDays(todayStr, -(6 - index))).map(
    (day) => ({
      day,
      label: weekdayShort(day),
      kcal: dayRollup(listEntries(person.id, day), resolveFood, recipeByVersion).totals.ENERC_KCAL,
    }),
  );

  return (
    <main className="mx-auto max-w-5xl px-5 py-6">
      <div className="mb-4">
        <PageHeader
          title="Profile"
          kicker={`For ${person.displayName}`}
          lead="Used to work out targets for this person. Nothing here is sent anywhere."
        />
      </div>

      {isDefaultProfile(profile) && (
        <p className="mb-4 rounded-xl border border-warn-line bg-warn-soft px-3 py-2 text-[11px] text-warn-ink">
          These are the default numbers, not {person.displayName}&apos;s. Change them and save to
          make the diary and plan use these targets.
        </p>
      )}

      <WeekStrip days={week} today={todayStr} />

      <ProfileEditor
        // The editor keeps the person's numbers in client state; remount it
        // on a person switch so one person's draft can never save onto
        // another person's diary.
        key={person.id}
        personId={person.id}
        personName={person.displayName}
        profile={profile}
        rules={getTargetRules(person.id)}
      />

      <footer className="mt-5">
        <p className="text-[11px] leading-relaxed text-faint">
          Energy uses Mifflin–St Jeor by default, or Katch–McArdle when body fat is known, with
          an activity multiplier and a goal adjustment. Protein scales with body weight. Minerals
          and vitamins are ICMR–NIN 2020 reference allowances, banded by sex and age, and are
          seed values that have not been through a verified review. Targets are a starting point
          to adjust against what actually happens, not medical advice.
        </p>
      </footer>
    </main>
  );
}
