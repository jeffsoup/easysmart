export const MAX_RANGE_DAYS = 365;

export type AbsolutePreset = "today" | "last_7_days" | "mtd" | "ytd";

export type SalesRangeMode = "absolute" | "custom";

export type ResolvedSalesRange = {
  mode: SalesRangeMode;
  preset: AbsolutePreset | null;
  startDate: string;
  endDate: string;
  label: string;
  timeZone: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const PRESET_LABELS: Record<AbsolutePreset, string> = {
  today: "Today",
  last_7_days: "The Last 7 Days",
  mtd: "Month to date",
  ytd: "Year to date",
};

export function isAbsolutePreset(value: string): value is AbsolutePreset {
  return (
    value === "today" ||
    value === "last_7_days" ||
    value === "mtd" ||
    value === "ytd"
  );
}

export function presetLabel(preset: AbsolutePreset): string {
  return PRESET_LABELS[preset];
}

export function formatRangeLabel(startDate: string, endDate: string): string {
  if (startDate === endDate) return formatShortDate(startDate);
  return `${formatShortDate(startDate)} – ${formatShortDate(endDate)}`;
}

function formatShortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return isoDate;
  return `${Number(month)}/${Number(day)}/${year}`;
}

/** Inclusive day count between YYYY-MM-DD dates. */
export function inclusiveDayCount(startDate: string, endDate: string): number {
  const start = parseUtcNoon(startDate);
  const end = parseUtcNoon(endDate);
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

export function validateCustomRange(
  startDate: string,
  endDate: string,
): string | null {
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    return "Enter valid start and end dates.";
  }
  if (startDate > endDate) {
    return "Start date must be on or before end date.";
  }
  const days = inclusiveDayCount(startDate, endDate);
  if (days > MAX_RANGE_DAYS) {
    return `Custom ranges can be at most ${MAX_RANGE_DAYS} days.`;
  }
  return null;
}

export function resolveAbsoluteRange(
  preset: AbsolutePreset,
  timeZone: string,
  now = new Date(),
): ResolvedSalesRange {
  const today = dateInZone(now, timeZone);
  let startDate = today;
  let endDate = today;

  switch (preset) {
    case "today":
      startDate = today;
      endDate = today;
      break;
    case "last_7_days":
      // Rolling window: today and the prior 6 local calendar days.
      startDate = addCalendarDays(today, -6);
      endDate = today;
      break;
    case "mtd":
      startDate = `${today.slice(0, 8)}01`;
      endDate = today;
      break;
    case "ytd":
      startDate = `${today.slice(0, 4)}-01-01`;
      endDate = today;
      break;
  }

  return {
    mode: "absolute",
    preset,
    startDate,
    endDate,
    label: PRESET_LABELS[preset],
    timeZone,
  };
}

export function resolveCustomRange(
  startDate: string,
  endDate: string,
  timeZone: string,
): ResolvedSalesRange {
  const error = validateCustomRange(startDate, endDate);
  if (error) throw new Error(error);

  return {
    mode: "custom",
    preset: null,
    startDate,
    endDate,
    label: formatRangeLabel(startDate, endDate),
    timeZone,
  };
}

/**
 * UTC instants covering local calendar days [startDate, endDate] in timeZone.
 * end is exclusive (start of the day after endDate).
 */
export function zonedRangeBounds(
  startDate: string,
  endDate: string,
  timeZone: string,
): { start: Date; end: Date } {
  const start = zonedDateTimeToUtc(startDate, 0, 0, 0, 0, timeZone);
  const dayAfterEnd = addCalendarDays(endDate, 1);
  const end = zonedDateTimeToUtc(dayAfterEnd, 0, 0, 0, 0, timeZone);
  return { start, end };
}

/** Every YYYY-MM-DD from startDate through endDate inclusive. */
export function eachDateInRange(
  startDate: string,
  endDate: string,
): string[] {
  const dates: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    dates.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }
  return dates;
}

export function dateInZone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function addCalendarDays(isoDate: string, days: number): string {
  const date = parseUtcNoon(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseUtcNoon(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00.000Z`);
}

/**
 * Convert a wall-clock local date/time in `timeZone` to a UTC Date.
 */
function zonedDateTimeToUtc(
  dateStr: string,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timeZone: string,
): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!year || !month || !day) {
    return new Date(`${dateStr}T00:00:00.000Z`);
  }

  let utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));

  for (let i = 0; i < 4; i += 1) {
    const parts = getZonedParts(utc, timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      parts.ms,
    );
    const desired = Date.UTC(year, month - 1, day, hour, minute, second, ms);
    const delta = desired - asUtc;
    if (delta === 0) break;
    utc = new Date(utc.getTime() + delta);
  }

  return utc;
}

function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const map = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    ms: 0,
  };
}
