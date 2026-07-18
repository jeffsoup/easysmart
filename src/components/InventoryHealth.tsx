"use client";

import { useMemo, useState } from "react";
import type {
  InventoryHealthReport,
  InventoryItemHealth,
  InventoryStatus,
} from "@/lib/inventory";
import { LEAD_TIME_DAYS, TARGET_COVER_DAYS } from "@/lib/inventory";

type Props = {
  report: InventoryHealthReport;
  error?: string | null;
};

type InventoryCategory =
  | "tracked"
  | "out_of_stock"
  | "reorder"
  | "slow_movers";

const STATUS_LABEL: Record<InventoryStatus, string> = {
  out_of_stock: "Out of stock",
  low_stock: "Low / reorder",
  slow_mover: "Slow mover",
  healthy: "Healthy",
};

const STATUS_CLASS: Record<InventoryStatus, string> = {
  out_of_stock: "bg-red-100 text-red-900",
  low_stock: "bg-amber-100 text-amber-950",
  slow_mover: "bg-stone-200 text-stone-800",
  healthy: "bg-teal-100 text-teal-950",
};

const CATEGORY_META: Record<
  InventoryCategory,
  { title: string; description: string }
> = {
  tracked: {
    title: "Tracked variations",
    description: "All catalog variations with inventory tracking enabled.",
  },
  out_of_stock: {
    title: "Out of stock",
    description: "Tracked items with zero (or negative) on-hand quantity.",
  },
  reorder: {
    title: "Reorder now",
    description: `Items with a suggested reorder quantity to reach ~${TARGET_COVER_DAYS} days of cover.`,
  },
  slow_movers: {
    title: "Slow movers",
    description: "Items with stock on hand and no sales in the last 30 days.",
  },
};

export function InventoryHealth({ report, error }: Props) {
  const [category, setCategory] = useState<InventoryCategory | null>(null);

  const attention = [
    ...report.outOfStock,
    ...report.lowStock,
    ...report.slowMovers,
  ];

  const categoryItems = useMemo(() => {
    if (!category) return [];
    switch (category) {
      case "tracked":
        return [...report.items].sort((a, b) => a.name.localeCompare(b.name));
      case "out_of_stock":
        return report.outOfStock;
      case "reorder":
        return report.reorderSuggestions;
      case "slow_movers":
        return report.slowMovers;
    }
  }, [category, report]);

  if (error) {
    return (
      <section>
        <Header />
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      </section>
    );
  }

  if (category) {
    return (
      <section>
        <Header />
        <CategoryList
          category={category}
          items={categoryItems}
          onBack={() => setCategory(null)}
        />
      </section>
    );
  }

  return (
    <section>
      <Header />

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        <StatButton
          label="Tracked variations"
          value={String(report.trackedCount)}
          onClick={() => setCategory("tracked")}
        />
        <StatButton
          label="Out of stock"
          value={String(report.outOfStock.length)}
          onClick={() => setCategory("out_of_stock")}
        />
        <StatButton
          label="Reorder now"
          value={String(report.reorderSuggestions.length)}
          onClick={() => setCategory("reorder")}
        />
        <StatButton
          label="Slow movers"
          value={String(report.slowMovers.length)}
          onClick={() => setCategory("slow_movers")}
        />
      </div>

      <p className="mt-3 text-sm text-stone-500">
        Click a summary box to view items in that category.
      </p>

      {report.cards.length > 0 ? (
        <ul className="mt-6 space-y-3">
          {report.cards.map((card) => (
            <li
              key={card}
              className="rounded-md border border-stone-300/80 bg-white px-4 py-3 text-sm leading-relaxed text-stone-800"
            >
              {card}
            </li>
          ))}
        </ul>
      ) : null}

      {report.reorderSuggestions.length > 0 ? (
        <div className="mt-8">
          <h3 className="font-serif text-xl tracking-tight">
            Reorder suggestions
          </h3>
          <div className="mt-3 overflow-hidden rounded-lg border border-stone-300/80 bg-white">
            <ReorderTable items={report.reorderSuggestions.slice(0, 20)} />
          </div>
        </div>
      ) : null}

      {attention.length > 0 ? (
        <div className="mt-8 overflow-hidden rounded-lg border border-stone-300/80 bg-white">
          <AttentionTable items={attention.slice(0, 25)} />
        </div>
      ) : report.trackedCount > 0 ? (
        <p className="mt-6 text-sm text-stone-500">
          No out-of-stock, low-stock, or slow-mover flags right now.
        </p>
      ) : null}
    </section>
  );
}

function Header() {
  return (
    <>
      <h2 className="font-serif text-3xl tracking-tight">Inventory health</h2>
      <p className="mt-2 max-w-2xl text-stone-600">
        Stock risk, slow movers, and reorder suggestions from Catalog +
        Inventory, with sell-through from the last 30 days of completed orders.
        Reorder qty targets ~{TARGET_COVER_DAYS} days of cover (assumes{" "}
        {LEAD_TIME_DAYS}-day lead time).
      </p>
    </>
  );
}

function CategoryList({
  category,
  items,
  onBack,
}: {
  category: InventoryCategory;
  items: InventoryItemHealth[];
  onBack: () => void;
}) {
  const meta = CATEGORY_META[category];

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-2xl tracking-tight">{meta.title}</h3>
          <p className="mt-1 text-sm text-stone-500">
            {meta.description} · {items.length} item
            {items.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-stone-400 px-3 py-1.5 text-sm text-stone-700 transition hover:bg-stone-100"
        >
          ← Back to inventory overview
        </button>
      </div>

      {items.length === 0 ? (
        <p className="mt-6 text-sm text-stone-500">
          No items in this category right now.
        </p>
      ) : category === "reorder" ? (
        <div className="mt-6 overflow-hidden rounded-lg border border-stone-300/80 bg-white">
          <ReorderTable items={items} />
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-lg border border-stone-300/80 bg-white">
          <AttentionTable items={items} showInsight />
        </div>
      )}
    </div>
  );
}

function StatButton({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-stone-300/80 bg-white px-4 py-4 text-left transition hover:border-teal-700/40 hover:bg-teal-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800"
    >
      <p className="text-xs uppercase tracking-[0.12em] text-stone-500">
        {label}
      </p>
      <p className="mt-2 font-serif text-2xl tracking-tight">{value}</p>
      <p className="mt-2 text-xs text-teal-800">View list →</p>
    </button>
  );
}

function ReorderTable({ items }: { items: InventoryItemHealth[] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-stone-200 bg-stone-50 text-stone-600">
        <tr>
          <th className="px-4 py-3 font-medium">Item</th>
          <th className="px-4 py-3 font-medium">On hand</th>
          <th className="px-4 py-3 font-medium">Avg / day</th>
          <th className="px-4 py-3 font-medium">Days cover</th>
          <th className="px-4 py-3 font-medium">Order qty</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.variationId} className="border-b border-stone-100">
            <td className="px-4 py-2.5">
              <div>{item.name}</div>
              {item.sku ? (
                <div className="text-xs text-stone-500">SKU {item.sku}</div>
              ) : null}
            </td>
            <td className="px-4 py-2.5 tabular-nums">{item.quantity}</td>
            <td className="px-4 py-2.5 tabular-nums">{item.avgDaily}</td>
            <td className="px-4 py-2.5 tabular-nums">
              {item.daysOfCover == null ? "—" : item.daysOfCover}
            </td>
            <td className="px-4 py-2.5 font-medium tabular-nums text-teal-900">
              {item.suggestedReorderQty}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AttentionTable({
  items,
  showInsight = false,
}: {
  items: InventoryItemHealth[];
  showInsight?: boolean;
}) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-stone-200 bg-stone-50 text-stone-600">
        <tr>
          <th className="px-4 py-3 font-medium">Item</th>
          <th className="px-4 py-3 font-medium">Status</th>
          <th className="px-4 py-3 font-medium">On hand</th>
          <th className="px-4 py-3 font-medium">Sold (30d)</th>
          <th className="px-4 py-3 font-medium">Days cover</th>
          {showInsight ? (
            <th className="px-4 py-3 font-medium">Note</th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.variationId} className="border-b border-stone-100">
            <td className="px-4 py-2.5">
              <div>{item.name}</div>
              {item.sku ? (
                <div className="text-xs text-stone-500">SKU {item.sku}</div>
              ) : null}
            </td>
            <td className="px-4 py-2.5">
              <span
                className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[item.status]}`}
              >
                {STATUS_LABEL[item.status]}
              </span>
            </td>
            <td className="px-4 py-2.5 tabular-nums">{item.quantity}</td>
            <td className="px-4 py-2.5 tabular-nums">{item.unitsSold30d}</td>
            <td className="px-4 py-2.5 tabular-nums">
              {item.daysOfCover == null ? "—" : item.daysOfCover}
            </td>
            {showInsight ? (
              <td className="max-w-xs px-4 py-2.5 text-stone-600">
                {item.insight}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
