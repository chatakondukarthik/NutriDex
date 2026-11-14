export function fmt(value: number | null, precision = 1): string {
  if (value == null) return "—";
  if (precision === 0) return Math.round(value).toLocaleString("en-IN");
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

export function fmtDay(day: string): string {
  const date = new Date(`${day}T00:00:00`);
  return date.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}
