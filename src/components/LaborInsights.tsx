"use client";

import { useMemo, useState } from "react";
import type {
  LaborInsightReport,
  LaborTeamMemberRow,
  LaborTimecardRow,
} from "@/lib/labor";
import type { TeamMemberItemSale, TeamMemberSalesRow } from "@/lib/teamSales";

type Props = {
  report: LaborInsightReport;
  error?: string | null;
};

type LaborCategory =
  | "hours"
  | "cost"
  | "splh"
  | "labor_pct"
  | "team_sales";

const CATEGORY_META: Record<
  LaborCategory,
  { title: string; description: string }
> = {
  hours: {
    title: "Labor hours",
    description: "Closed timecards in the lookback window, newest first.",
  },
  cost: {
    title: "Estimated labor cost",
    description:
      "Timecard-level cost from hourly rate × hours worked (unpaid breaks excluded).",
  },
  splh: {
    title: "Sales per labor hour",
    description:
      "Store-level SPLH context with each team member’s share of hours worked.",
  },
  labor_pct: {
    title: "Labor % of sales",
    description:
      "How estimated labor cost breaks down by team member versus net sales.",
  },
  team_sales: {
    title: "Sales by team member",
    description:
      "Item sales attributed via Payments.team_member_id → Orders. Reflects who ran the payment on POS.",
  },
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatHours(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function LaborInsights({ report, error }: Props) {
  const [category, setCategory] = useState<LaborCategory | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

  const selectedMember = useMemo(() => {
    if (!selectedMemberId) return null;
    return (
      report.teamSales.byTeamMember.find(
        (row) => row.teamMemberId === selectedMemberId,
      ) ?? null
    );
  }, [report.teamSales.byTeamMember, selectedMemberId]);

  if (error) {
    return (
      <section>
        <Header lookbackDays={report.lookbackDays} />
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      </section>
    );
  }

  if (category === "team_sales" && selectedMember) {
    return (
      <section>
        <Header lookbackDays={report.lookbackDays} />
        <TeamMemberItemsDetail
          member={selectedMember}
          onBack={() => setSelectedMemberId(null)}
        />
      </section>
    );
  }

  if (category) {
    return (
      <section>
        <Header lookbackDays={report.lookbackDays} />
        <CategoryDetail
          category={category}
          report={report}
          onBack={() => {
            setCategory(null);
            setSelectedMemberId(null);
          }}
          onSelectMember={(id) => setSelectedMemberId(id)}
        />
      </section>
    );
  }

  return (
    <section>
      <Header lookbackDays={report.lookbackDays} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatButton
          label="Labor hours"
          value={formatHours(report.laborHours)}
          onClick={() => setCategory("hours")}
        />
        <StatButton
          label="Est. labor cost"
          value={
            report.hasWageData
              ? formatCurrency(report.estimatedLaborCost)
              : "—"
          }
          onClick={() => setCategory("cost")}
        />
        <StatButton
          label="Sales / labor hour"
          value={
            report.salesPerLaborHour != null
              ? formatCurrency(report.salesPerLaborHour)
              : "—"
          }
          onClick={() => setCategory("splh")}
        />
        <StatButton
          label="Labor % of sales"
          value={
            report.laborCostPctOfSales != null
              ? `${report.laborCostPctOfSales}%`
              : "—"
          }
          onClick={() => setCategory("labor_pct")}
        />
        <StatButton
          label="Sales by team member"
          value={formatCurrency(report.teamSales.attributedSales)}
          onClick={() => setCategory("team_sales")}
        />
      </div>

      <p className="mt-3 text-sm text-stone-500">
        Click a summary box for detail. “Sales by team member” uses payment
        attribution (staff logged into POS).
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

      {report.timecardCount > 0 ? (
        <p className="mt-4 text-sm text-stone-500">
          Based on {report.timecardCount} closed timecard
          {report.timecardCount === 1 ? "" : "s"} and{" "}
          {formatCurrency(report.netSales)} net sales in the period.
        </p>
      ) : null}
    </section>
  );
}

function Header({ lookbackDays }: { lookbackDays: number }) {
  return (
    <>
      <h2 className="font-serif text-3xl tracking-tight">Labor insights</h2>
      <p className="mt-2 max-w-2xl text-stone-600">
        Payroll-adjacent view from Square Team + Labor timecards (last{" "}
        {lookbackDays} days) — not full payroll runs. Cost is estimated from
        hourly rates on closed timecards. Item sales by team member come from
        Payments → Orders attribution.
      </p>
    </>
  );
}

function CategoryDetail({
  category,
  report,
  onBack,
  onSelectMember,
}: {
  category: LaborCategory;
  report: LaborInsightReport;
  onBack: () => void;
  onSelectMember: (teamMemberId: string) => void;
}) {
  const meta = CATEGORY_META[category];

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-2xl tracking-tight">{meta.title}</h3>
          <p className="mt-1 text-sm text-stone-500">{meta.description}</p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-stone-400 px-3 py-1.5 text-sm text-stone-700 transition hover:bg-stone-100"
        >
          ← Back to labor overview
        </button>
      </div>

      {category === "hours" || category === "cost" ? (
        <div className="mt-6 overflow-hidden rounded-lg border border-stone-300/80 bg-white">
          <TimecardTable
            rows={report.timecards}
            emphasizeCost={category === "cost"}
          />
        </div>
      ) : null}

      {category === "splh" || category === "labor_pct" ? (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {category === "splh" ? (
              <>
                <MiniStat
                  label="Store SPLH"
                  value={
                    report.salesPerLaborHour != null
                      ? formatCurrency(report.salesPerLaborHour)
                      : "—"
                  }
                />
                <MiniStat
                  label="Net sales"
                  value={formatCurrency(report.netSales)}
                />
                <MiniStat
                  label="Labor hours"
                  value={formatHours(report.laborHours)}
                />
              </>
            ) : (
              <>
                <MiniStat
                  label="Labor % of sales"
                  value={
                    report.laborCostPctOfSales != null
                      ? `${report.laborCostPctOfSales}%`
                      : "—"
                  }
                />
                <MiniStat
                  label="Est. labor cost"
                  value={
                    report.hasWageData
                      ? formatCurrency(report.estimatedLaborCost)
                      : "—"
                  }
                />
                <MiniStat
                  label="Net sales"
                  value={formatCurrency(report.netSales)}
                />
              </>
            )}
          </div>
          <div className="mt-6 overflow-hidden rounded-lg border border-stone-300/80 bg-white">
            <TeamMemberTable
              rows={report.byTeamMember}
              mode={category === "splh" ? "hours" : "cost"}
            />
          </div>
        </>
      ) : null}

      {category === "team_sales" ? (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <MiniStat
              label="Attributed sales"
              value={formatCurrency(report.teamSales.attributedSales)}
            />
            <MiniStat
              label="Attributed orders"
              value={String(report.teamSales.attributedOrderCount)}
            />
            <MiniStat
              label="Unattributed payments"
              value={String(report.teamSales.unattributedPaymentCount)}
            />
          </div>
          <div className="mt-6 overflow-hidden rounded-lg border border-stone-300/80 bg-white">
            <SalesByMemberTable
              rows={report.teamSales.byTeamMember}
              onSelectMember={onSelectMember}
            />
          </div>
          {report.teamSales.byTeamMember.length === 0 ? (
            <p className="mt-6 text-sm text-stone-500">
              No payment-attributed item sales yet. Take POS payments while a
              team member is logged in, reconnect with PAYMENTS_READ if needed,
              then refresh.
            </p>
          ) : null}
        </>
      ) : null}

      {(category === "hours" || category === "cost") &&
      report.timecards.length === 0 ? (
        <p className="mt-6 text-sm text-stone-500">
          No closed timecards in this period yet.
        </p>
      ) : null}
    </div>
  );
}

function TeamMemberItemsDetail({
  member,
  onBack,
}: {
  member: TeamMemberSalesRow;
  onBack: () => void;
}) {
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-2xl tracking-tight">
            {member.teamMemberName}
          </h3>
          <p className="mt-1 text-sm text-stone-500">
            {formatCurrency(member.netSales)} attributed · {member.orderCount}{" "}
            order{member.orderCount === 1 ? "" : "s"} · {member.itemCount} item
            {member.itemCount === 1 ? "" : "s"}
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-stone-400 px-3 py-1.5 text-sm text-stone-700 transition hover:bg-stone-100"
        >
          ← Back to sales by team member
        </button>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-stone-300/80 bg-white">
        <ItemSalesTable items={member.items} />
      </div>
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
      <p className="mt-2 text-xs text-teal-800">View detail →</p>
    </button>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stone-300/80 bg-white px-4 py-4">
      <p className="text-xs uppercase tracking-[0.12em] text-stone-500">{label}</p>
      <p className="mt-2 font-serif text-2xl tracking-tight">{value}</p>
    </div>
  );
}

function TimecardTable({
  rows,
  emphasizeCost,
}: {
  rows: LaborTimecardRow[];
  emphasizeCost: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-stone-500">No timecards to show.</p>
    );
  }

  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-stone-200 bg-stone-50 text-stone-600">
        <tr>
          <th className="px-4 py-3 font-medium">Date</th>
          <th className="px-4 py-3 font-medium">Team member</th>
          <th className="px-4 py-3 font-medium">Job</th>
          <th className="px-4 py-3 font-medium">Hours</th>
          <th className="px-4 py-3 font-medium">Rate</th>
          <th
            className={`px-4 py-3 font-medium ${emphasizeCost ? "text-teal-900" : ""}`}
          >
            Cost
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-stone-100">
            <td className="px-4 py-2.5 tabular-nums">{row.workDate}</td>
            <td className="px-4 py-2.5">{row.teamMemberName}</td>
            <td className="px-4 py-2.5 text-stone-600">
              {row.jobTitle ?? "—"}
            </td>
            <td className="px-4 py-2.5 tabular-nums">
              {formatHours(row.hours)}
            </td>
            <td className="px-4 py-2.5 tabular-nums">
              {row.hourlyRate != null ? formatCurrency(row.hourlyRate) : "—"}
            </td>
            <td
              className={`px-4 py-2.5 tabular-nums ${emphasizeCost ? "font-medium text-teal-900" : ""}`}
            >
              {row.laborCost != null ? formatCurrency(row.laborCost) : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TeamMemberTable({
  rows,
  mode,
}: {
  rows: LaborTeamMemberRow[];
  mode: "hours" | "cost";
}) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-stone-500">
        No team member totals yet.
      </p>
    );
  }

  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-stone-200 bg-stone-50 text-stone-600">
        <tr>
          <th className="px-4 py-3 font-medium">Team member</th>
          <th className="px-4 py-3 font-medium">Timecards</th>
          <th className="px-4 py-3 font-medium">Hours</th>
          <th className="px-4 py-3 font-medium">Hours share</th>
          <th className="px-4 py-3 font-medium">Est. cost</th>
          {mode === "cost" ? (
            <th className="px-4 py-3 font-medium">Cost share</th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.teamMemberId} className="border-b border-stone-100">
            <td className="px-4 py-2.5">{row.teamMemberName}</td>
            <td className="px-4 py-2.5 tabular-nums">{row.timecardCount}</td>
            <td className="px-4 py-2.5 tabular-nums">
              {formatHours(row.hours)}
            </td>
            <td className="px-4 py-2.5 tabular-nums">{row.hoursSharePct}%</td>
            <td className="px-4 py-2.5 tabular-nums">
              {row.laborCost != null ? formatCurrency(row.laborCost) : "—"}
            </td>
            {mode === "cost" ? (
              <td className="px-4 py-2.5 tabular-nums">
                {row.costSharePct != null ? `${row.costSharePct}%` : "—"}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SalesByMemberTable({
  rows,
  onSelectMember,
}: {
  rows: TeamMemberSalesRow[];
  onSelectMember: (teamMemberId: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-stone-500">
        No attributed sales to show.
      </p>
    );
  }

  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-stone-200 bg-stone-50 text-stone-600">
        <tr>
          <th className="px-4 py-3 font-medium">Team member</th>
          <th className="px-4 py-3 font-medium">Orders</th>
          <th className="px-4 py-3 font-medium">Items</th>
          <th className="px-4 py-3 font-medium">Net sales</th>
          <th className="px-4 py-3 font-medium" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.teamMemberId} className="border-b border-stone-100">
            <td className="px-4 py-2.5">{row.teamMemberName}</td>
            <td className="px-4 py-2.5 tabular-nums">{row.orderCount}</td>
            <td className="px-4 py-2.5 tabular-nums">{row.itemCount}</td>
            <td className="px-4 py-2.5 font-medium tabular-nums text-teal-900">
              {formatCurrency(row.netSales)}
            </td>
            <td className="px-4 py-2.5 text-right">
              <button
                type="button"
                onClick={() => onSelectMember(row.teamMemberId)}
                className="text-sm text-teal-800 underline-offset-2 hover:underline"
              >
                View items
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ItemSalesTable({ items }: { items: TeamMemberItemSale[] }) {
  if (items.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-stone-500">No line items found.</p>
    );
  }

  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-stone-200 bg-stone-50 text-stone-600">
        <tr>
          <th className="px-4 py-3 font-medium">Item</th>
          <th className="px-4 py-3 font-medium">Qty</th>
          <th className="px-4 py-3 font-medium">Net sales</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr
            key={`${item.catalogObjectId ?? item.name}-${item.netSales}`}
            className="border-b border-stone-100"
          >
            <td className="px-4 py-2.5">{item.name}</td>
            <td className="px-4 py-2.5 tabular-nums">{item.quantity}</td>
            <td className="px-4 py-2.5 tabular-nums">
              {formatCurrency(item.netSales)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
