import { NextResponse } from "next/server";
import { fetchDayItemSales } from "@/lib/dayItemSales";
import {
  fetchDailyNetSales,
  resolveMerchantTimeZone,
  summarizeSales,
} from "@/lib/reporting";
import {
  isAbsolutePreset,
  resolveAbsoluteRange,
  resolveCustomRange,
  validateCustomRange,
  type AbsolutePreset,
  type ResolvedSalesRange,
} from "@/lib/salesRange";
import { getSession } from "@/lib/session";
import { createSellerClient } from "@/lib/square";

export const dynamic = "force-dynamic";

function scopeHint(message: string) {
  if (/FORBIDDEN|insufficient|permission|UNAUTHORIZED/i.test(message)) {
    return `${message} — Disconnect and reconnect (open Sandbox Seller Dashboard first) to grant the latest OAuth scopes, including PAYMENTS_READ.`;
  }
  return message;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session.accessToken) {
    return NextResponse.json({ error: "Not connected" }, { status: 401 });
  }

  const url = new URL(request.url);
  const client = createSellerClient(session.accessToken);

  let range: ResolvedSalesRange;
  try {
    const timeZone = await resolveMerchantTimeZone(client);
    range = parseRangeFromSearchParams(url.searchParams, timeZone);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Invalid date range",
      },
      { status: 400 },
    );
  }

  try {
    const [sales, dayItems] = await Promise.all([
      fetchDailyNetSales(client, range),
      fetchDayItemSales(client, range),
    ]);

    return NextResponse.json({
      points: sales.points,
      byHour: sales.byHour,
      byDayHour: sales.byDayHour,
      byDayItems: dayItems.byDay,
      source: sales.source,
      timeZone: sales.timeZone,
      range: sales.range,
      summary: summarizeSales(sales.points),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: scopeHint(
          err instanceof Error ? err.message : "Failed to load sales data",
        ),
      },
      { status: 500 },
    );
  }
}

export function parseRangeFromSearchParams(
  params: URLSearchParams,
  timeZone: string,
): ResolvedSalesRange {
  const mode = params.get("mode") ?? "absolute";
  const presetParam = params.get("preset") ?? "last_7_days";

  if (mode === "custom") {
    const startDate = params.get("from") ?? "";
    const endDate = params.get("to") ?? "";
    const error = validateCustomRange(startDate, endDate);
    if (error) throw new Error(error);
    return resolveCustomRange(startDate, endDate, timeZone);
  }

  if (!isAbsolutePreset(presetParam)) {
    throw new Error("Invalid absolute preset.");
  }

  return resolveAbsoluteRange(presetParam as AbsolutePreset, timeZone);
}
