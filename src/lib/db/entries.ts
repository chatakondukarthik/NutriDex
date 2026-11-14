import { randomUUID } from "node:crypto";
import { db } from "./client";

export interface Entry {
  id: string;
  foodId: string;
  /** Resolved gram weight. Stored, so the entry survives a portion-table change. */
  grams: number;
  /** What the user actually typed, kept for display and audit. */
  amount: number;
  unit: string;
  day: string;
  createdAt: string;
}

interface Row {
  id: string;
  food_id: string;
  grams: number;
  amount: number;
  unit: string;
  day: string;
  created_at: string;
}

function toEntry(row: Row): Entry {
  return {
    id: row.id,
    foodId: row.food_id,
    grams: row.grams,
    amount: row.amount,
    unit: row.unit,
    day: row.day,
    createdAt: row.created_at,
  };
}

export function listEntries(day: string): Entry[] {
  const rows = db
    .prepare("SELECT * FROM entries WHERE day = ? ORDER BY created_at ASC")
    .all(day) as unknown as Row[];
  return rows.map(toEntry);
}

export function addEntry(input: {
  foodId: string;
  grams: number;
  amount: number;
  unit: string;
  day: string;
}): Entry {
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO entries (id, food_id, grams, amount, unit, day, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.foodId, input.grams, input.amount, input.unit, input.day, createdAt);

  return { id, ...input, createdAt };
}

export function removeEntry(id: string): void {
  db.prepare("DELETE FROM entries WHERE id = ?").run(id);
}

export function today(): string {
  // Local calendar day. Timezone handling is deliberately naive in S1.
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}
