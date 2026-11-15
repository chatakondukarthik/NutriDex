export interface GlossaryEntry {
  code: string;
  name: string;
  plain: string;
  why: string;
  unit: string;
  dailyOrWeekly: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  { code: "ENERC_KCAL", name: "Energy (calories)", plain: "The fuel your body burns to keep you alive and moving.", why: "Too little and you tire and lose muscle; too much and it is stored as fat.", unit: "kcal", dailyOrWeekly: "Daily anchor — judged every day." },
  { code: "PROCNT", name: "Protein", plain: "The building block for muscle, skin, enzymes and hormones.", why: "Needed daily; low protein costs muscle even on a diet.", unit: "g", dailyOrWeekly: "Daily anchor — judged every day." },
  { code: "FAT", name: "Fat", plain: "Concentrated energy and the carrier for vitamins A, D, E and K.", why: "Essential, but a weekly ceiling because it is calorie-dense.", unit: "g", dailyOrWeekly: "Weekly limit — judged over the week." },
  { code: "CHOCDF", name: "Carbohydrate", plain: "The body's preferred quick fuel, especially for the brain.", why: "A weekly minimum: you need enough, but a single low day is fine.", unit: "g", dailyOrWeekly: "Weekly minimum." },
  { code: "FIBTG", name: "Fibre", plain: "The part of plants you cannot digest, but your gut bacteria can.", why: "Feeds the gut, steadies blood sugar, and keeps you full.", unit: "g", dailyOrWeekly: "Weekly minimum." },
  { code: "SUGAR", name: "Total sugars", plain: "Sugars naturally present or added in food.", why: "A weekly ceiling; the limit is about added sugar, but the label rarely separates them.", unit: "g", dailyOrWeekly: "Weekly limit." },
  { code: "NA", name: "Sodium", plain: "Salt's main mineral; controls fluid balance and nerve signals.", why: "A weekly ceiling — too much raises blood pressure over time.", unit: "mg", dailyOrWeekly: "Weekly limit." },
  { code: "K", name: "Potassium", plain: "Sodium's partner; relaxes blood vessels and steadies the heartbeat.", why: "Most people get too little; more potassium offsets sodium.", unit: "mg", dailyOrWeekly: "Weekly minimum." },
  { code: "CA", name: "Calcium", plain: "The mineral your bones and teeth are made of.", why: "Low intake over years costs bone density.", unit: "mg", dailyOrWeekly: "Weekly minimum." },
  { code: "FE", name: "Iron", plain: "Carries oxygen in your blood.", why: "Low iron means fatigue and poor focus, especially for menstruating women.", unit: "mg", dailyOrWeekly: "Weekly minimum." },
  { code: "ZN", name: "Zinc", plain: "A helper for immunity, wound healing and taste.", why: "Needed in small amounts; gaps are common on plant-only diets.", unit: "mg", dailyOrWeekly: "Weekly minimum." },
  { code: "MG", name: "Magnesium", plain: "Involved in 300+ reactions, including muscle and nerve function.", why: "Low intake is linked to cramps and poor sleep.", unit: "mg", dailyOrWeekly: "Weekly minimum." },
  { code: "VITA_RAE", name: "Vitamin A", plain: "Vision, skin and immune defence.", why: "Too little hurts night vision; too much from supplements is toxic.", unit: "µg", dailyOrWeekly: "Weekly minimum." },
  { code: "VITC", name: "Vitamin C", plain: "Antioxidant and collagen builder; helps absorb iron.", why: "Water-soluble, so it needs regular intake rather than one big dose.", unit: "mg", dailyOrWeekly: "Weekly minimum." },
  { code: "VITD", name: "Vitamin D", plain: "Regulates calcium and immune function; made in skin from sunlight.", why: "Deficiency is common indoors; food sources are limited.", unit: "µg", dailyOrWeekly: "Weekly minimum." },
  { code: "VITB12", name: "Vitamin B12", plain: "Nerve and blood-cell health.", why: "Found almost only in animal foods; vegans need a supplement or fortified food.", unit: "µg", dailyOrWeekly: "Weekly minimum." },
  { code: "FOL", name: "Folate (B9)", plain: "Cell division and DNA repair; critical before and in pregnancy.", why: "Low folate raises neural-tube risk in early pregnancy.", unit: "µg", dailyOrWeekly: "Weekly minimum." },
  { code: "VITB6", name: "Vitamin B6", plain: "Protein metabolism and brain chemistry.", why: "Needed alongside protein; gaps are uncommon but real on restricted diets.", unit: "mg", dailyOrWeekly: "Weekly minimum." },
];
