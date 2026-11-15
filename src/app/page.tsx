import { Diary } from "@/components/diary";
import { listFoods } from "@/lib/db/foods";
import { listEntries, today } from "@/lib/db/entries";
import { getProfile } from "@/lib/db/profile";
import { targetsFor } from "@/lib/targets";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const { day: requested } = await searchParams;
  const day = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : today();
  const entries = listEntries(day);
  const targets = targetsFor(getProfile());

  return <Diary foods={listFoods()} entries={entries} targets={targets} day={day} />;
}
