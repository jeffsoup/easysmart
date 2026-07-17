import { ReportingHelper, type Order, type SquareClient } from "square";
import { getSquareConfig } from "./env";

export type DailyNetSalesPoint = {
  date: string;
  netSales: number;
};

export type SalesFetchResult = {
  points: DailyNetSalesPoint[];
  /** Reporting API is production-only; sandbox uses Orders search. */
  source: "reporting" | "orders";
};

export async function fetchDailyNetSalesLast30Days(
  client: SquareClient,
): Promise<SalesFetchResult> {
  const { environment } = getSquareConfig();

  if (environment === "sandbox") {
    const points = await fetchDailyNetSalesFromOrders(client);
    return { points, source: "orders" };
  }

  const points = await fetchDailyNetSalesFromReporting(client);
  return { points, source: "reporting" };
}

async function fetchDailyNetSalesFromReporting(
  client: SquareClient,
): Promise<DailyNetSalesPoint[]> {
  const response = await ReportingHelper.loadAndWait(client, {
    query: {
      measures: ["Sales.net_sales"],
      timeDimensions: [
        {
          dimension: "Sales.local_reporting_timestamp",
          dateRange: "last 30 days",
          granularity: "day",
        },
      ],
    },
  });

  const rows = normalizeLoadRows(response.data);
  const points: DailyNetSalesPoint[] = rows.map((row) => {
    const dateRaw =
      row["Sales.local_reporting_timestamp.day"] ??
      row["Sales.local_reporting_timestamp"] ??
      "";
    const salesRaw = row["Sales.net_sales"] ?? 0;

    return {
      date: String(dateRaw).slice(0, 10),
      netSales: Number(salesRaw) || 0,
    };
  });

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Sandbox fallback: Reporting API returns 404 on sandbox hosts.
 * Approximate net sales from completed Orders (total − tax − tip).
 */
async function fetchDailyNetSalesFromOrders(
  client: SquareClient,
): Promise<DailyNetSalesPoint[]> {
  const locations = await client.locations.list();
  const locationIds = (locations.locations ?? [])
    .map((location) => location.id)
    .filter((id): id is string => Boolean(id));

  if (locationIds.length === 0) {
    return fillLast30Days({});
  }

  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 29);
  start.setUTCHours(0, 0, 0, 0);

  const byDate = new Map<string, number>();
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
      const date = orderDateKey(order);
      if (!date) continue;
      const cents = orderNetSalesCents(order);
      byDate.set(date, (byDate.get(date) ?? 0) + cents);
    }

    cursor = page.cursor;
  } while (cursor);

  const dollars: Record<string, number> = {};
  for (const [date, cents] of byDate) {
    dollars[date] = cents / 100;
  }

  return fillLast30Days(dollars);
}

function orderNetSalesCents(order: Order): number {
  const amounts = order.netAmounts;
  const total = Number(amounts?.totalMoney?.amount ?? order.totalMoney?.amount ?? 0);
  const tax = Number(amounts?.taxMoney?.amount ?? 0);
  const tip = Number(amounts?.tipMoney?.amount ?? 0);
  return Math.max(0, total - tax - tip);
}

function orderDateKey(order: Order): string | null {
  const raw = order.closedAt ?? order.createdAt;
  if (!raw) return null;
  return String(raw).slice(0, 10);
}

function fillLast30Days(byDate: Record<string, number>): DailyNetSalesPoint[] {
  const points: DailyNetSalesPoint[] = [];
  const cursor = new Date();
  cursor.setUTCHours(12, 0, 0, 0);
  cursor.setUTCDate(cursor.getUTCDate() - 29);

  for (let i = 0; i < 30; i += 1) {
    const date = cursor.toISOString().slice(0, 10);
    points.push({ date, netSales: byDate[date] ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return points;
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
