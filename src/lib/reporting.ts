import { ReportingHelper, type Order, type SquareClient } from "square";
import { getSquareConfig } from "./env";
import {
  eachDateInRange,
  type ResolvedSalesRange,
  zonedRangeBounds,
} from "./salesRange";

export type DailyNetSalesPoint = {
  date: string;
  netSales: number;
};

/** Net sales rolled up by hour of day (0–23) over the lookback window. */
export type HourlyNetSalesPoint = {
  hour: number;
  label: string;
  netSales: number;
};

export type SalesFetchResult = {
  points: DailyNetSalesPoint[];
  /** Hour-of-day totals across the full lookback window. */
  byHour: HourlyNetSalesPoint[];
  /** Per-day hourly breakdown for drill-down (keys are YYYY-MM-DD). */
  byDayHour: Record<string, HourlyNetSalesPoint[]>;
  /** Reporting API is production-only; sandbox uses Orders search. */
  source: "reporting" | "orders";
  timeZone: string;
  range: ResolvedSalesRange;
};

export async function fetchDailyNetSales(
  client: SquareClient,
  range: ResolvedSalesRange,
): Promise<SalesFetchResult> {
  const { environment } = getSquareConfig();

  if (environment === "sandbox") {
    return fetchSalesFromOrders(client, range);
  }

  return fetchSalesFromReporting(client, range);
}

/** @deprecated Prefer fetchDailyNetSales with an explicit range. */
export async function fetchDailyNetSalesLast30Days(
  client: SquareClient,
): Promise<SalesFetchResult> {
  const timeZone = await resolvePrimaryTimeZone(client);
  const end = new Date();
  const endDate = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(end);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  const startDate = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(start);

  return fetchDailyNetSales(client, {
    mode: "custom",
    preset: null,
    startDate,
    endDate,
    label: "Last 30 days",
    timeZone,
  });
}

async function fetchSalesFromReporting(
  client: SquareClient,
  range: ResolvedSalesRange,
): Promise<SalesFetchResult> {
  const dateRange: [string, string] = [range.startDate, range.endDate];
  const timeZone = range.timeZone || (await resolvePrimaryTimeZone(client));

  const [dailyResponse, hourlyResponse] = await Promise.all([
    ReportingHelper.loadAndWait(client, {
      query: {
        measures: ["Sales.net_sales"],
        timeDimensions: [
          {
            dimension: "Sales.local_reporting_timestamp",
            dateRange,
            granularity: "day",
          },
        ],
      },
    }),
    ReportingHelper.loadAndWait(client, {
      query: {
        measures: ["Sales.net_sales"],
        timeDimensions: [
          {
            dimension: "Sales.local_reporting_timestamp",
            dateRange,
            granularity: "hour",
          },
        ],
      },
    }),
  ]);

  const pointsByDate = new Map<string, number>();
  for (const row of normalizeLoadRows(dailyResponse.data)) {
    const dateRaw =
      row["Sales.local_reporting_timestamp.day"] ??
      row["Sales.local_reporting_timestamp"] ??
      "";
    const date = String(dateRaw).slice(0, 10);
    if (!date) continue;
    pointsByDate.set(date, Number(row["Sales.net_sales"] ?? 0) || 0);
  }

  const points = fillDateRange(
    range.startDate,
    range.endDate,
    Object.fromEntries(pointsByDate),
  );

  const byHourMap = new Map<number, number>();
  const byDateHour = new Map<string, Map<number, number>>();

  for (const row of normalizeLoadRows(hourlyResponse.data)) {
    const stamp =
      row["Sales.local_reporting_timestamp.hour"] ??
      row["Sales.local_reporting_timestamp"] ??
      "";
    const stampStr = String(stamp);
    const hour = hourFromStamp(stampStr, timeZone);
    const date = dateFromStamp(stampStr, timeZone);
    const amount = Number(row["Sales.net_sales"] ?? 0) || 0;
    if (hour == null) continue;

    byHourMap.set(hour, (byHourMap.get(hour) ?? 0) + amount);
    if (date) {
      const dayMap = byDateHour.get(date) ?? new Map<number, number>();
      dayMap.set(hour, (dayMap.get(hour) ?? 0) + amount);
      byDateHour.set(date, dayMap);
    }
  }

  return {
    points,
    byHour: fillHours(byHourMap),
    byDayHour: toByDayHour(
      byDateHour,
      points.map((p) => p.date),
    ),
    source: "reporting",
    timeZone,
    range: { ...range, timeZone },
  };
}

/**
 * Sandbox fallback: Reporting API returns 404 on sandbox hosts.
 * Approximate net sales from completed Orders (total − tax − tip).
 */
async function fetchSalesFromOrders(
  client: SquareClient,
  range: ResolvedSalesRange,
): Promise<SalesFetchResult> {
  const locations = await client.locations.list();
  const locationList = locations.locations ?? [];
  const locationIds = locationList
    .map((location) => location.id)
    .filter((id): id is string => Boolean(id));
  const timeZone =
    range.timeZone || locationList[0]?.timezone?.trim() || "UTC";

  if (locationIds.length === 0) {
    const points = fillDateRange(range.startDate, range.endDate, {});
    return {
      points,
      byHour: fillHours(new Map()),
      byDayHour: toByDayHour(new Map(), points.map((p) => p.date)),
      source: "orders",
      timeZone,
      range: { ...range, timeZone },
    };
  }

  const { start, end } = zonedRangeBounds(
    range.startDate,
    range.endDate,
    timeZone,
  );

  const byDate = new Map<string, number>();
  const byHour = new Map<number, number>();
  const byDateHour = new Map<string, Map<number, number>>();
  let cursor: string | undefined;

  do {
    const page = await client.orders.search({
      locationIds,
      cursor,
      query: {
        filter: {
          stateFilter: { states: ["COMPLETED"] },
          dateTimeFilter: {
            closedAt: {
              startAt: start.toISOString(),
              endAt: end.toISOString(),
            },
          },
        },
        sort: {
          sortField: "CLOSED_AT",
          sortOrder: "ASC",
        },
      },
      limit: 100,
    });

    for (const order of page.orders ?? []) {
      const cents = orderNetSalesCents(order);
      const date = orderDateKey(order, timeZone);
      const hour = orderHourKey(order, timeZone);

      if (date && date >= range.startDate && date <= range.endDate) {
        byDate.set(date, (byDate.get(date) ?? 0) + cents);
      }
      if (
        date &&
        date >= range.startDate &&
        date <= range.endDate &&
        hour != null
      ) {
        byHour.set(hour, (byHour.get(hour) ?? 0) + cents);
        const dayMap = byDateHour.get(date) ?? new Map<number, number>();
        dayMap.set(hour, (dayMap.get(hour) ?? 0) + cents);
        byDateHour.set(date, dayMap);
      }
    }

    cursor = page.cursor;
  } while (cursor);

  const dollarsByDate: Record<string, number> = {};
  for (const [date, cents] of byDate) {
    dollarsByDate[date] = cents / 100;
  }

  const dollarsByHour = new Map<number, number>();
  for (const [hour, cents] of byHour) {
    dollarsByHour.set(hour, cents / 100);
  }

  const dollarsByDateHour = new Map<string, Map<number, number>>();
  for (const [date, hourMap] of byDateHour) {
    const converted = new Map<number, number>();
    for (const [hour, cents] of hourMap) {
      converted.set(hour, cents / 100);
    }
    dollarsByDateHour.set(date, converted);
  }

  const points = fillDateRange(
    range.startDate,
    range.endDate,
    dollarsByDate,
  );
  return {
    points,
    byHour: fillHours(dollarsByHour),
    byDayHour: toByDayHour(
      dollarsByDateHour,
      points.map((p) => p.date),
    ),
    source: "orders",
    timeZone,
    range: { ...range, timeZone },
  };
}

async function resolvePrimaryTimeZone(client: SquareClient): Promise<string> {
  const locations = await client.locations.list();
  return locations.locations?.[0]?.timezone?.trim() || "UTC";
}

export async function resolveMerchantTimeZone(
  client: SquareClient,
): Promise<string> {
  return resolvePrimaryTimeZone(client);
}

function orderNetSalesCents(order: Order): number {
  const amounts = order.netAmounts;
  const total = Number(
    amounts?.totalMoney?.amount ?? order.totalMoney?.amount ?? 0,
  );
  const tax = Number(amounts?.taxMoney?.amount ?? 0);
  const tip = Number(amounts?.tipMoney?.amount ?? 0);
  return Math.max(0, total - tax - tip);
}

function orderTimestamp(order: Order): string | null {
  return order.closedAt ?? order.createdAt ?? null;
}

function orderDateKey(order: Order, timeZone: string): string | null {
  const raw = orderTimestamp(order);
  if (!raw) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(raw));
  } catch {
    return String(raw).slice(0, 10);
  }
}

function orderHourKey(order: Order, timeZone: string): number | null {
  const raw = orderTimestamp(order);
  if (!raw) return null;
  return hourFromStamp(raw, timeZone);
}

function hourFromStamp(stamp: string, timeZone: string): number | null {
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return null;

  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(date);
    const hourPart = parts.find((part) => part.type === "hour")?.value;
    const hour = Number(hourPart);
    return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
  } catch {
    return date.getUTCHours();
  }
}

function dateFromStamp(stamp: string, timeZone: string): string | null {
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) {
    return stamp.length >= 10 ? stamp.slice(0, 10) : null;
  }

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

function toByDayHour(
  byDateHour: Map<string, Map<number, number>>,
  dates: string[],
): Record<string, HourlyNetSalesPoint[]> {
  const result: Record<string, HourlyNetSalesPoint[]> = {};
  for (const date of dates) {
    result[date] = fillHours(byDateHour.get(date) ?? new Map());
  }
  return result;
}

export function formatDisplayDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return isoDate;
  return `${Number(month)}/${Number(day)}/${year}`;
}

function fillDateRange(
  startDate: string,
  endDate: string,
  byDate: Record<string, number>,
): DailyNetSalesPoint[] {
  return eachDateInRange(startDate, endDate).map((date) => ({
    date,
    netSales: byDate[date] ?? 0,
  }));
}

function fillHours(byHour: Map<number, number>): HourlyNetSalesPoint[] {
  const points: HourlyNetSalesPoint[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    points.push({
      hour,
      label: formatHourLabel(hour),
      netSales: byHour.get(hour) ?? 0,
    });
  }
  return points;
}

export function formatHourLabel(hour: number): string {
  const period = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${period}`;
}

function normalizeLoadRows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    return data as Array<Record<string, unknown>>;
  }
  return [];
}

export function summarizeSales(points: DailyNetSalesPoint[]) {
  const total = points.reduce((sum, p) => sum + p.netSales, 0);
  const daysWithSales = points.filter((p) => p.netSales > 0).length;
  const average = daysWithSales > 0 ? total / daysWithSales : 0;
  const peak = points.reduce(
    (best, p) => (p.netSales > best.netSales ? p : best),
    { date: "—", netSales: 0 },
  );

  return { total, average, peak, dayCount: points.length };
}

export function summarizeHourlySales(byHour: HourlyNetSalesPoint[]) {
  const peak = byHour.reduce(
    (best, p) => (p.netSales > best.netSales ? p : best),
    { hour: 0, label: "—", netSales: 0 },
  );
  return { peak };
}
