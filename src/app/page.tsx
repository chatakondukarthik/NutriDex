import { Diary } from "@/components/diary";
import { listFoods } from "@/lib/db/foods";
import { listEntries, today } from "@/lib/db/entries";
import { getProfile } from "@/lib/db/profile";
import { targetsFor } from "@/lib/targets";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const day = today();
  const entries = listEntries(day);
  const targets = targetsFor(getProfile());

  return <Diary foods={listFoods()} entries={entries} targets={targets} day={day} />;
}
