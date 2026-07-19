"use client";

import {
  useCallback,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { HourlySalesChart } from "@/components/HourlySalesChart";
import { SalesChart } from "@/components/SalesChart";
import type { DayItemSaleRow } from "@/lib/dayItemSales";
import type {
  DailyNetSalesPoint,
  HourlyNetSalesPoint,
} from "@/lib/reporting";
import {
  formatDisplayDate,
  formatHourLabel,
  summarizeHourlySales,
  summarizeSales,
} from "@/lib/reporting";
import {
  MAX_RANGE_DAYS,
  dateInZone,
  type AbsolutePreset,
  type ResolvedSalesRange,
  type SalesRangeMode,
  validateCustomRange,
} from "@/lib/salesRange";

type SalesPayload = {
  points: DailyNetSalesPoint[];
  byHour: HourlyNetSalesPoint[];
  byDayHour: Record<string, HourlyNetSalesPoint[]>;
  byDayItems: Record<string, DayItemSaleRow[]>;
  source: "reporting" | "orders" | null;
  timeZone: string;
  range: ResolvedSalesRange;
  summary: {
    total: number;
    average: number;
    peak: DailyNetSalesPoint;
  };
  error: string | null;
};

type Props = {
  initial: SalesPayload;
};

const ABSOLUTE_OPTIONS: { value: AbsolutePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "last_7_days", label: "The Last 7 Days" },
  { value: "mtd", label: "Month to date" },
  { value: "ytd", label: "Year to date" },
];

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

function buildQuery(params: {
  mode: SalesRangeMode;
  preset: AbsolutePreset;
  from: string;
  to: string;
}) {
  const query = new URLSearchParams({ mode: params.mode });
  if (params.mode === "absolute") {
    query.set("preset", params.preset);
  } else {
    query.set("from", params.from);
    query.set("to", params.to);
  }
  return query.toString();
}

export function NetSalesPanel({ initial }: Props) {
  const [data, setData] = useState<SalesPayload>(initial);
  const [mode, setMode] = useState<SalesRangeMode>(initial.range.mode);
  const [preset, setPreset] = useState<AbsolutePreset>(
    initial.range.preset ?? "last_7_days",
  );
  const [customFrom, setCustomFrom] = useState(initial.range.startDate);
  const [customTo, setCustomTo] = useState(initial.range.endDate);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [itemsDate, setItemsDate] = useState<string | null>(null);

  const {
    points,
    byHour,
    byDayHour,
    byDayItems,
    source,
    timeZone,
    range,
    summary,
    error,
  } = data;

  const loadRange = useCallback(
    (next: {
      mode: SalesRangeMode;
      preset: AbsolutePreset;
      from: string;
      to: string;
    }) => {
      if (next.mode === "custom") {
        const validation = validateCustomRange(next.from, next.to);
        if (validation) {
          setRangeError(validation);
          return;
        }
      }
      setRangeError(null);
      setSelectedDate(null);
      setItemsDate(null);

      startTransition(async () => {
        try {
          const res = await fetch(`/api/sales?${buildQuery(next)}`);
          const body = (await res.json()) as SalesPayload & {
            error?: string;
          };
          if (!res.ok) {
            setData((prev) => ({
              ...prev,
              error: body.error ?? "Failed to load sales data",
            }));
            return;
          }
          setData({
            points: body.points,
            byHour: body.byHour,
            byDayHour: body.byDayHour,
            byDayItems: body.byDayItems,
            source: body.source,
            timeZone: body.timeZone,
            range: body.range,
            summary: body.summary ?? summarizeSales(body.points),
            error: null,
          });
          if (body.range.mode === "custom") {
            setCustomFrom(body.range.startDate);
            setCustomTo(body.range.endDate);
          }
        } catch {
          setData((prev) => ({
            ...prev,
            error: "Failed to load sales data",
          }));
        }
      });
    },
    [],
  );

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

  const dayItems = useMemo(() => {
    if (!itemsDate) return [];
    return byDayItems[itemsDate] ?? [];
  }, [byDayItems, itemsDate]);

  const dayItemsTotal = useMemo(
    () => dayItems.reduce((sum, row) => sum + row.soldAmount, 0),
    [dayItems],
  );

  const title = `Net sales · ${range.label}`;
  const today = dateInZone(new Date(), timeZone);

  const timeframeControls = (
    <TimeframeControls
      mode={mode}
      preset={preset}
      customFrom={customFrom}
      customTo={customTo}
      maxEndDate={today}
      disabled={isPending}
      rangeError={rangeError}
      onPresetChange={(nextPreset) => {
        setPreset(nextPreset);
        setMode("absolute");
        setRangeError(null);
        loadRange({
          mode: "absolute",
          preset: nextPreset,
          from: customFrom,
          to: customTo,
        });
      }}
      onShowCustom={() => {
        setMode("custom");
        setRangeError(null);
      }}
      onCustomFromChange={setCustomFrom}
      onCustomToChange={setCustomTo}
      onApplyCustom={() => {
        setMode("custom");
        loadRange({
          mode: "custom",
          preset,
          from: customFrom,
          to: customTo,
        });
      }}
    />
  );

  if (error && points.length === 0) {
    return (
      <section>
        <h2 className="font-serif text-3xl tracking-tight">{title}</h2>
        <div className="mt-6">{timeframeControls}</div>
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      </section>
    );
  }

  if (itemsDate) {
    return (
      <section>
        <h2 className="font-serif text-3xl tracking-tight">{title}</h2>
        <div className="mt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-serif text-2xl tracking-tight">
                Items sold · {formatDisplayDate(itemsDate)}
              </h3>
              <p className="mt-1 text-sm text-stone-500">
                {dayItems.length} line item{dayItems.length === 1 ? "" : "s"} ·{" "}
                {formatCurrency(dayItemsTotal)}
                {timeZone ? ` · ${timeZone}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setItemsDate(null)}
              className="rounded-md border border-stone-400 px-3 py-1.5 text-sm text-stone-700 transition hover:bg-stone-100"
            >
              ← Back to daily view
            </button>
          </div>

          <div className="mt-6 overflow-hidden rounded-lg border border-stone-300/80 bg-white">
            <DayItemsTable rows={dayItems} />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-3xl tracking-tight">{title}</h2>
          <p className="mt-2 max-w-2xl text-stone-600">
            {source === "orders"
              ? "Sandbox mode: aggregated from completed Orders (Reporting API is production-only)."
              : source === "reporting"
                ? "Pulled from Square Reporting (`Sales.net_sales`). Data typically lags ~15 minutes."
                : "Loading sales for the selected range."}
          </p>
        </div>
        {isPending ? (
          <p className="text-sm text-stone-500" aria-live="polite">
            Updating…
          </p>
        ) : null}
      </div>

      <div className="mt-6">{timeframeControls}</div>

      {error ? (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      ) : null}

      <div
        className={`mt-6 mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 ${isPending ? "opacity-60" : ""}`}
      >
        <Stat label="Total net sales" value={formatCurrency(summary.total)} />
        <Stat
          label="Avg on selling days"
          value={formatCurrency(summary.average)}
        />
        <Stat
          label="Peak day"
          value={
            <>
              {formatCurrency(summary.peak.netSales)}
              <br />
              {summary.peak.date}
            </>
          }
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

      {selectedDate && selectedDayHours ? (
        <div
          className={`rounded-lg border border-stone-300/80 bg-white px-4 py-5 sm:px-6 ${isPending ? "opacity-60" : ""}`}
        >
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
              ← Back to charts
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
        </div>
      ) : (
        <div
          className={`grid gap-4 lg:grid-cols-2 ${isPending ? "opacity-60" : ""}`}
        >
          <div className="rounded-lg border border-stone-300/80 bg-white px-4 py-5 sm:px-5">
            <h3 className="text-sm font-medium text-stone-700">
              {range.preset === "last_7_days"
                ? "The Last 7 Days"
                : "Sales by day"}
            </h3>
            <p className="mt-1 text-sm text-stone-500">
              Hover for details, click a day for hourly breakdown.
            </p>
            <div className="mt-3">
              <SalesChart points={points} onSelectDay={setSelectedDate} />
            </div>
            {points.length === 0 || points.every((p) => p.netSales === 0) ? (
              <p className="mt-4 text-sm text-stone-500">
                No completed orders in this range. In the Sandbox Seller
                Dashboard, take a few test payments (Virtual Terminal or POS),
                then refresh this page.
              </p>
            ) : null}
          </div>

          <div className="rounded-lg border border-stone-300/80 bg-white px-4 py-5 sm:px-5">
            <h3 className="text-sm font-medium text-stone-700">
              Sales by hour of day
            </h3>
            <p className="mt-1 text-sm text-stone-500">
              Totals by local hour for {range.label.toLowerCase()}
              {timeZone ? ` (${timeZone})` : ""}.
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
        </div>
      )}

      <div
        className={`mt-8 overflow-hidden rounded-lg border border-stone-300/80 bg-white ${isPending ? "opacity-60" : ""}`}
      >
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
                    onClick={() => setItemsDate(p.date)}
                    className="text-sm text-teal-800 underline-offset-2 hover:underline"
                  >
                    View items sold
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TimeframeControls({
  mode,
  preset,
  customFrom,
  customTo,
  maxEndDate,
  disabled,
  rangeError,
  onPresetChange,
  onShowCustom,
  onCustomFromChange,
  onCustomToChange,
  onApplyCustom,
}: {
  mode: SalesRangeMode;
  preset: AbsolutePreset;
  customFrom: string;
  customTo: string;
  maxEndDate: string;
  disabled: boolean;
  rangeError: string | null;
  onPresetChange: (preset: AbsolutePreset) => void;
  onShowCustom: () => void;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
  onApplyCustom: () => void;
}) {
  return (
    <div className="rounded-lg border border-stone-300/80 bg-white px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Timeframe"
          value={mode === "absolute" ? preset : ""}
          disabled={disabled}
          onChange={(e) => {
            const value = e.target.value as AbsolutePreset;
            if (value) onPresetChange(value);
          }}
          className={`rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-800 disabled:opacity-60 ${
            mode === "custom" ? "text-stone-500" : ""
          }`}
        >
          {mode === "custom" ? (
            <option value="" disabled>
              Custom range
            </option>
          ) : null}
          {ABSOLUTE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={disabled}
          onClick={onShowCustom}
          className={`rounded-md px-3 py-1.5 text-sm transition disabled:opacity-60 ${
            mode === "custom"
              ? "bg-teal-800 text-white"
              : "border border-stone-300 text-stone-700 hover:bg-stone-100"
          }`}
        >
          Custom
        </button>
      </div>

      {mode === "custom" ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm text-stone-600">
            <span className="mb-1 block text-xs uppercase tracking-[0.1em] text-stone-500">
              Start
            </span>
            <input
              type="date"
              value={customFrom}
              max={customTo || maxEndDate}
              disabled={disabled}
              onChange={(e) => onCustomFromChange(e.target.value)}
              className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-stone-800"
            />
          </label>
          <label className="text-sm text-stone-600">
            <span className="mb-1 block text-xs uppercase tracking-[0.1em] text-stone-500">
              End
            </span>
            <input
              type="date"
              value={customTo}
              max={maxEndDate}
              min={customFrom}
              disabled={disabled}
              onChange={(e) => onCustomToChange(e.target.value)}
              className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-stone-800"
            />
          </label>
          <button
            type="button"
            disabled={disabled}
            onClick={onApplyCustom}
            className="rounded-md bg-teal-800 px-3 py-1.5 text-sm text-white transition hover:bg-teal-900 disabled:opacity-60"
          >
            Apply range
          </button>
          <p className="basis-full text-xs text-stone-500">
            Custom ranges can be at most {MAX_RANGE_DAYS} days.
          </p>
        </div>
      ) : null}

      {rangeError ? (
        <p className="mt-2 text-sm text-red-700">{rangeError}</p>
      ) : null}
    </div>
  );
}

type DayItemSortKey =
  | "sku"
  | "itemName"
  | "soldAmount"
  | "soldAt"
  | "teamMemberName";

type SortDir = "asc" | "desc";

function DayItemsTable({ rows }: { rows: DayItemSaleRow[] }) {
  const [sortKey, setSortKey] = useState<DayItemSortKey>("soldAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const copy = [...rows];
    const dir = sortDir === "asc" ? 1 : -1;

    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "sku":
          cmp = (a.sku ?? "").localeCompare(b.sku ?? "", undefined, {
            sensitivity: "base",
            numeric: true,
          });
          break;
        case "itemName":
          cmp = a.itemName.localeCompare(b.itemName, undefined, {
            sensitivity: "base",
          });
          break;
        case "soldAmount":
          cmp = a.soldAmount - b.soldAmount;
          break;
        case "soldAt":
          cmp = a.soldAt.localeCompare(b.soldAt);
          break;
        case "teamMemberName":
          cmp = a.teamMemberName.localeCompare(b.teamMemberName, undefined, {
            sensitivity: "base",
          });
          break;
      }
      if (cmp === 0) return a.id.localeCompare(b.id);
      return cmp * dir;
    });

    return copy;
  }, [rows, sortKey, sortDir]);

  function toggleSort(key: DayItemSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "soldAmount" || key === "soldAt" ? "desc" : "asc");
  }

  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-stone-500">
        No line items sold on this day.
      </p>
    );
  }

  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-stone-200 bg-stone-50 text-stone-600">
        <tr>
          <SortableTh
            label="SKU"
            sortKey="sku"
            activeKey={sortKey}
            dir={sortDir}
            onSort={toggleSort}
          />
          <SortableTh
            label="Item name"
            sortKey="itemName"
            activeKey={sortKey}
            dir={sortDir}
            onSort={toggleSort}
          />
          <SortableTh
            label="Sold amount"
            sortKey="soldAmount"
            activeKey={sortKey}
            dir={sortDir}
            onSort={toggleSort}
          />
          <SortableTh
            label="Date & time"
            sortKey="soldAt"
            activeKey={sortKey}
            dir={sortDir}
            onSort={toggleSort}
          />
          <SortableTh
            label="Team member"
            sortKey="teamMemberName"
            activeKey={sortKey}
            dir={sortDir}
            onSort={toggleSort}
          />
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => (
          <tr key={row.id} className="border-b border-stone-100">
            <td className="px-4 py-2.5 tabular-nums text-stone-600">
              {row.sku ?? "—"}
            </td>
            <td className="px-4 py-2.5">
              <div>{row.itemName}</div>
              {row.quantity !== 1 ? (
                <div className="text-xs text-stone-500">Qty {row.quantity}</div>
              ) : null}
            </td>
            <td className="px-4 py-2.5 tabular-nums">
              {formatCurrency(row.soldAmount)}
            </td>
            <td className="px-4 py-2.5 whitespace-nowrap">{row.soldAtLabel}</td>
            <td className="px-4 py-2.5">{row.teamMemberName}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
}: {
  label: string;
  sortKey: DayItemSortKey;
  activeKey: DayItemSortKey;
  dir: SortDir;
  onSort: (key: DayItemSortKey) => void;
}) {
  const active = activeKey === sortKey;
  return (
    <th className="px-4 py-3 font-medium">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 text-left transition hover:text-stone-900"
        aria-sort={
          active ? (dir === "asc" ? "ascending" : "descending") : "none"
        }
      >
        {label}
        <span
          className={`text-xs ${active ? "text-stone-700" : "text-stone-300"}`}
          aria-hidden
        >
          {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-300/80 bg-white px-4 py-4">
      <p className="text-xs uppercase tracking-[0.12em] text-stone-500">{label}</p>
      <p className="mt-2 font-serif text-2xl tracking-tight">{value}</p>
    </div>
  );
}
