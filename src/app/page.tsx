import { Diary } from "@/components/diary";
import { FOODS } from "@/lib/data/foods";
import { listEntries, today } from "@/lib/db/entries";
import { getProfile } from "@/lib/db/profile";
import { targetsFor } from "@/lib/targets";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const day = today();
  const entries = listEntries(day);
  const targets = targetsFor(getProfile());

  return <Diary foods={FOODS} entries={entries} targets={targets} day={day} />;
}
