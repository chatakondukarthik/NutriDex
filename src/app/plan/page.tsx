import { PlanBoard } from "@/components/plan-board";
import { listFoods } from "@/lib/db/foods";
import { today, listEntries } from "@/lib/db/entries";
import { getPlan, listPlanEntries } from "@/lib/db/plan";
import { getProfile } from "@/lib/db/profile";
import { getTargetRules } from "@/lib/db/settings";
import { listRecipeOptions } from "@/lib/db/recipes";
import { getActivePerson } from "@/lib/person-server";
import { weekStart } from "@/lib/plan";
import { isDefaultProfile } from "@/lib/profile";
import { targetsFor } from "@/lib/targets";

export const dynamic = "force-dynamic";

interface PlanPageProps {
  searchParams: Promise<{ week?: string }>;
}

/**
 * One week of the plan.
 *
 * Reading the page never creates a plan row; the first item added does.
 * That keeps a page view from leaving empty weeks behind, and means the
 * board can tell "nothing planned" apart from "no plan yet" — they are
 * the same thing to the user.
 */
export default async function PlanPage({ searchParams }: PlanPageProps) {
  const person = await getActivePerson();
  const params = await searchParams;
  const requested = isDay(params.week) ? params.week : today();
  const week = weekStart(requested);

  const plan = getPlan(person.id, week);
  const entries = plan ? listPlanEntries(person.id, plan.id) : [];
  const profile = getProfile(person.id);

  return (
    <PlanBoard
      // The board holds the person's entries in client state; remount it on
      // a person switch so a draft can never belong to the wrong diary.
      key={person.id}
      week={week}
      today={today()}
      foods={listFoods()}
      recipes={listRecipeOptions()}
      entries={entries}
      targets={targetsFor(profile, getTargetRules(person.id))}
      profileIsDefault={isDefaultProfile(profile)}
      hasDiaryEntries={listEntries(person.id, today()).length > 0}
    />
  );
}

function isDay(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
