import { Diary } from "@/components/diary";
import { FOODS } from "@/lib/data/foods";
import { listEntries, today } from "@/lib/db/entries";
import { DEFAULT_TARGETS } from "@/lib/targets";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const day = today();
  const entries = listEntries(day);

  return <Diary foods={FOODS} entries={entries} targets={DEFAULT_TARGETS} day={day} />;
}
