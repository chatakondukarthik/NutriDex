import { PlanBoard } from "@/components/plan-board";
import { FOODS } from "@/lib/data/foods";
import { today } from "@/lib/db/entries";
import { getPlan, listPlanEntries } from "@/lib/db/plan";
import { getProfile } from "@/lib/db/profile";
import { listRecipeOptions } from "@/lib/db/recipes";
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
  const params = await searchParams;
  const requested = isDay(params.week) ? params.week : today();
  const week = weekStart(requested);

  const plan = getPlan(week);
  const entries = plan ? listPlanEntries(plan.id) : [];
  const profile = getProfile();

  return (
    <PlanBoard
      week={week}
      today={today()}
      foods={FOODS}
      recipes={listRecipeOptions()}
      entries={entries}
      targets={targetsFor(profile)}
      profileIsDefault={isDefaultProfile(profile)}
    />
  );
}

function isDay(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
