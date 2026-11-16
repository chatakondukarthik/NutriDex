import { notFound } from "next/navigation";
import { getCapturedFood } from "@/lib/db/foods";
import { getFoodDefaultPin } from "@/lib/db/defaults";
import { FoodEditor } from "@/components/food-editor";
import { aiStatus } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

export default async function EditFoodPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const food = getCapturedFood(id);
  if (!food) notFound();
  return (
    <FoodEditor
      initial={food}
      mode="edit"
      ai={{ enabled: aiStatus().enabled, hasKey: aiStatus().hasKey }}
      defaultPin={getFoodDefaultPin(id)}
    />
  );
}
