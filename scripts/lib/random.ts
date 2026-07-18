import { randomUUID } from "node:crypto";

export function idempotencyKey(): string {
  return randomUUID();
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomChoice<T>(items: readonly T[]): T {
  return items[randomInt(0, items.length - 1)];
}

/** Pick `count` distinct items (count is clamped to items.length). */
export function randomSample<T>(items: readonly T[], count: number): T[] {
  const pool = [...items];
  const sampled: T[] = [];
  const n = Math.min(count, pool.length);

  for (let i = 0; i < n; i += 1) {
    const index = randomInt(0, pool.length - 1);
    sampled.push(pool.splice(index, 1)[0]);
  }

  return sampled;
}

/** Picks one item with probability proportional to `weight(item)`. Falls back to a uniform pick if all weights are 0. */
export function weightedChoice<T>(items: readonly T[], weight: (item: T) => number): T {
  const total = items.reduce((sum, item) => sum + Math.max(0, weight(item)), 0);
  if (total <= 0) return randomChoice(items);

  let target = Math.random() * total;
  for (const item of items) {
    target -= Math.max(0, weight(item));
    if (target <= 0) return item;
  }
  return items[items.length - 1];
}

/** Weighted sampling without replacement (clamped to items.length). */
export function weightedSample<T>(
  items: readonly T[],
  count: number,
  weight: (item: T) => number,
): T[] {
  const pool = [...items];
  const picked: T[] = [];

  for (let i = 0; i < count && pool.length > 0; i += 1) {
    const chosen = weightedChoice(pool, weight);
    picked.push(chosen);
    pool.splice(pool.indexOf(chosen), 1);
  }

  return picked;
}

/** A random time today between `hourStart` and `hourEnd` (local server time), as a Date. */
export function randomTimeToday(hourStart = 8, hourEnd = 20): Date {
  const date = new Date();
  date.setHours(randomInt(hourStart, hourEnd), randomInt(0, 59), 0, 0);
  return date;
}

/** A random time on a specific day offset from today (0 = today, 1 = yesterday, ...). */
export function randomTimeDaysAgo(
  daysAgo: number,
  hourStart = 8,
  hourEnd = 20,
): Date {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(randomInt(hourStart, hourEnd), randomInt(0, 59), 0, 0);
  return date;
}
