"use client";

import { useState, type ReactNode } from "react";

const TABS = [
  { id: "sales", label: "Net Sales" },
  { id: "inventory", label: "Inventory Health" },
  { id: "labor", label: "Labor Insights" },
  { id: "customers", label: "Customers" },
] as const;

type TabId = (typeof TABS)[number]["id"];

type Props = {
  sales: ReactNode;
  inventory: ReactNode;
  labor: ReactNode;
  customers: ReactNode;
};

export function DashboardTabs({
  sales,
  inventory,
  labor,
  customers,
}: Props) {
  const [active, setActive] = useState<TabId>("sales");

  const panel =
    active === "sales"
      ? sales
      : active === "inventory"
        ? inventory
        : active === "labor"
          ? labor
          : customers;

  return (
    <>
      <nav
        aria-label="Dashboard sections"
        className="border-b border-stone-300/70 bg-[#faf8f5]"
      >
        <div className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-6">
          {TABS.map((tab) => {
            const isActive = tab.id === active;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActive(tab.id)}
                aria-current={isActive ? "page" : undefined}
                className={[
                  "relative whitespace-nowrap px-4 py-3 text-sm font-medium transition",
                  isActive
                    ? "text-teal-900"
                    : "text-stone-500 hover:text-stone-800",
                ].join(" ")}
              >
                {tab.label}
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-teal-800"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="mx-auto max-w-5xl px-6 py-10">{panel}</div>
    </>
  );
}
