import type { LaborInsightReport } from "@/lib/labor";

type Props = {
  report: LaborInsightReport;
  error?: string | null;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export function LaborInsights({ report, error }: Props) {
  return (
    <section>
      <h2 className="font-serif text-3xl tracking-tight">Labor insights</h2>
      <p className="mt-2 max-w-2xl text-stone-600">
        Payroll-adjacent view from Square Team + Labor timecards (last{" "}
        {report.lookbackDays} days) — not full payroll runs. Cost is estimated
        from hourly rates on closed timecards.
      </p>

      {error ? (
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Labor hours"
              value={
                Number.isInteger(report.laborHours)
                  ? String(report.laborHours)
                  : report.laborHours.toFixed(1)
              }
            />
            <Stat
              label="Est. labor cost"
              value={
                report.hasWageData
                  ? formatCurrency(report.estimatedLaborCost)
                  : "—"
              }
            />
            <Stat
              label="Sales / labor hour"
              value={
                report.salesPerLaborHour != null
                  ? formatCurrency(report.salesPerLaborHour)
                  : "—"
              }
            />
            <Stat
              label="Labor % of sales"
              value={
                report.laborCostPctOfSales != null
                  ? `${report.laborCostPctOfSales}%`
                  : "—"
              }
            />
          </div>

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
