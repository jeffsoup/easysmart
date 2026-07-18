"use client";

import { useMemo, useState } from "react";
import { HourlySalesChart } from "@/components/HourlySalesChart";
import { SalesChart } from "@/components/SalesChart";
import type {
  DailyNetSalesPoint,
  HourlyNetSalesPoint,
} from "@/lib/reporting";
import {
  formatDisplayDate,
  formatHourLabel,
  summarizeHourlySales,
} from "@/lib/reporting";

type Props = {
  points: DailyNetSalesPoint[];
  byHour: HourlyNetSalesPoint[];
  byDayHour: Record<string, HourlyNetSalesPoint[]>;
  source: "reporting" | "orders" | null;
  timeZone: string;
  error: string | null;
  summary: {
    total: number;
    average: number;
    peak: DailyNetSalesPoint;
  };
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function emptyDayHours(): HourlyNetSalesPoint[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: formatHourLabel(hour),
    netSales: 0,
  }));
}

export function NetSalesPanel({
  points,
  byHour,
  byDayHour,
  source,
  timeZone,
  error,
  summary,
}: Props) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const hourlySummary = summarizeHourlySales(byHour);
  const hasHourlySales = byHour.some((p) => p.netSales > 0);

  const selectedDayHours = useMemo(() => {
    if (!selectedDate) return null;
    return byDayHour[selectedDate] ?? emptyDayHours();
  }, [byDayHour, selectedDate]);

  const selectedDayTotal = useMemo(() => {
    if (!selectedDate) return 0;
    return (
      points.find((p) => p.date === selectedDate)?.netSales ??
      selectedDayHours?.reduce((sum, p) => sum + p.netSales, 0) ??
      0
    );
  }, [points, selectedDate, selectedDayHours]);

  const selectedDayPeak = selectedDayHours
    ? summarizeHourlySales(selectedDayHours).peak
    : null;

  return (
    <section>
      <h2 className="font-serif text-3xl tracking-tight">
        Net sales · last 30 days
      </h2>
      <p className="mt-2 max-w-2xl text-stone-600">
        {source === "orders"
          ? "Sandbox mode: aggregated from completed Orders (Reporting API is production-only)."
          : source === "reporting"
            ? "Pulled from Square Reporting (`Sales.net_sales`). Data typically lags ~15 minutes."
            : "Loading sales for the last 30 days."}
      </p>

      {error ? (
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      ) : (
        <>
          <div className="mt-6 mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total net sales" value={formatCurrency(summary.total)} />
            <Stat
              label="Avg on selling days"
              value={formatCurrency(summary.average)}
            />
            <Stat
              label="Peak day"
              value={`${formatCurrency(summary.peak.netSales)} · ${summary.peak.date}`}
            />
            <Stat
              label="Peak hour"
              value={
                hourlySummary.peak.netSales > 0
                  ? `${formatCurrency(hourlySummary.peak.netSales)} · ${hourlySummary.peak.label}`
                  : "—"
              }
            />
          </div>

          <div className="rounded-lg border border-stone-300/80 bg-white px-4 py-5 sm:px-6">
            {selectedDate && selectedDayHours ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium text-stone-700">
                      Hourly sales · {formatDisplayDate(selectedDate)}
                    </h3>
                    <p className="mt-1 text-sm text-stone-500">
                      {formatCurrency(selectedDayTotal)} total
                      {selectedDayPeak && selectedDayPeak.netSales > 0
                        ? ` · peak ${selectedDayPeak.label} (${formatCurrency(selectedDayPeak.netSales)})`
                        : ""}
                      {timeZone ? ` · ${timeZone}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedDate(null)}
                    className="rounded-md border border-stone-400 px-3 py-1.5 text-sm text-stone-700 transition hover:bg-stone-100"
                  >
                    ← Back to daily view
                  </button>
                </div>
                <div className="mt-3">
                  <HourlySalesChart points={selectedDayHours} />
                </div>
                {selectedDayTotal === 0 ? (
                  <p className="mt-4 text-sm text-stone-500">
                    No sales recorded on this day.
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium text-stone-700">
                      Daily trend
                    </h3>
                    <p className="mt-1 text-sm text-stone-500">
                      Hover a day for details, then click to see that day by hour.
                    </p>
                  </div>
                </div>
                <div className="mt-3">
                  <SalesChart points={points} onSelectDay={setSelectedDate} />
                </div>
                {points.length === 0 || points.every((p) => p.netSales === 0) ? (
                  <p className="mt-4 text-sm text-stone-500">
                    No completed orders in the last 30 days. In the Sandbox Seller
                    Dashboard, take a few test payments (Virtual Terminal or POS),
                    then refresh this page.
                  </p>
                ) : null}
              </>
            )}
          </div>

          {!selectedDate ? (
            <div className="mt-8 rounded-lg border border-stone-300/80 bg-white px-4 py-5 sm:px-6">
              <h3 className="text-sm font-medium text-stone-700">
                Sales by hour of day
              </h3>
              <p className="mt-1 text-sm text-stone-500">
                Total net sales in each local hour over the last 30 days
                {timeZone ? ` (${timeZone})` : ""}. Useful for spotting lunch,
                dinner, and soft dayparts.
              </p>
              <div className="mt-3">
                <HourlySalesChart points={byHour} />
              </div>
              {!hasHourlySales ? (
                <p className="mt-4 text-sm text-stone-500">
                  No hourly sales yet. Once orders land across different times of
                  day, this chart will show your busiest hours.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-8 overflow-hidden rounded-lg border border-stone-300/80 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-stone-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Net sales</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {[...points].reverse().map((p) => (
                  <tr key={p.date} className="border-b border-stone-100">
                    <td className="px-4 py-2.5">{p.date}</td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {formatCurrency(p.netSales)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedDate(p.date)}
                        className="text-sm text-teal-800 underline-offset-2 hover:underline"
                      >
                        View hours
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stone-300/80 bg-white px-4 py-4">
      <p className="text-xs uppercase tracking-[0.12em] text-stone-500">{label}</p>
      <p className="mt-2 font-serif text-2xl tracking-tight">{value}</p>
    </div>
  );
}
