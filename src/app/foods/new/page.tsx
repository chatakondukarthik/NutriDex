import { FoodEditor } from "@/components/food-editor";
import { aiStatus } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

export default function NewFoodPage() {
  return <FoodEditor mode="create" ai={{ enabled: aiStatus().enabled, hasKey: aiStatus().hasKey }} />;
}
