export function fmt(value: number | null, precision = 1): string {
  if (value == null) return "—";
  if (precision === 0) return Math.round(value).toLocaleString("en-IN");
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

/** Render a stored quantity in the unit the user originally chose. */
export function fmtQuantity(amount: number, unit: string): string {
  const precision = amount % 1 === 0 ? 0 : 1;
  if (unit.startsWith("portion:")) {
    const label = unit.slice("portion:".length);
    return amount === 1 ? label : `${fmt(amount, precision)} × ${label}`;
  }
  return `${fmt(amount, precision)} ${unit}`;
}

/**
 * Render a mass. Small amounts keep one decimal so a pinch of salt does
 * not read as "0 g"; anything over 10 g rounds, because false precision
 * on a portion weight implies accuracy the data does not have.
 */
export function fmtMass(grams: number | null): string {
  if (grams == null) return "—";
  if (Math.abs(grams) < 10) {
    return grams.toLocaleString("en-IN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    });
  }
  return Math.round(grams).toLocaleString("en-IN");
}

export function fmtDay(day: string): string {
  const date = new Date(`${day}T00:00:00`);
  return date.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}
