import { SalesChart } from "@/components/SalesChart";
import type { DailyNetSalesPoint } from "@/lib/reporting";

type Props = {
  points: DailyNetSalesPoint[];
  source: "reporting" | "orders" | null;
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

export function NetSalesPanel({ points, source, error, summary }: Props) {
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
          <div className="mt-6 mb-8 grid gap-4 sm:grid-cols-3">
            <Stat label="Total net sales" value={formatCurrency(summary.total)} />
            <Stat
              label="Avg on selling days"
              value={formatCurrency(summary.average)}
            />
            <Stat
              label="Peak day"
              value={`${formatCurrency(summary.peak.netSales)} · ${summary.peak.date}`}
            />
          </div>

          <div className="rounded-lg border border-stone-300/80 bg-white px-4 py-5 sm:px-6">
            <SalesChart points={points} />
            {points.length === 0 || points.every((p) => p.netSales === 0) ? (
              <p className="mt-4 text-sm text-stone-500">
                No completed orders in the last 30 days. In the Sandbox Seller
                Dashboard, take a few test payments (Virtual Terminal or POS),
                then refresh this page.
              </p>
            ) : null}
          </div>

          <div className="mt-8 overflow-hidden rounded-lg border border-stone-300/80 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-stone-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Net sales</th>
                </tr>
              </thead>
              <tbody>
                {[...points].reverse().map((p) => (
                  <tr key={p.date} className="border-b border-stone-100">
                    <td className="px-4 py-2.5">{p.date}</td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {formatCurrency(p.netSales)}
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
