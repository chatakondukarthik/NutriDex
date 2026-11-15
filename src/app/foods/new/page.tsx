import { FoodEditor } from "@/components/food-editor";

export const dynamic = "force-dynamic";

export default function NewFoodPage() {
  return <FoodEditor mode="create" />;
}
