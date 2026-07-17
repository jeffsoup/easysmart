import Link from "next/link";
import { redirect } from "next/navigation";
import { InventoryHealth } from "@/components/InventoryHealth";
import { SalesChart } from "@/components/SalesChart";
import {
  fetchInventoryHealth,
  type InventoryHealthReport,
} from "@/lib/inventory";
import {
  fetchDailyNetSalesLast30Days,
  summarizeSales,
} from "@/lib/reporting";
import { getSession } from "@/lib/session";
import { createSellerClient } from "@/lib/square";

export const dynamic = "force-dynamic";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function scopeHint(message: string) {
  if (/FORBIDDEN|insufficient|permission|UNAUTHORIZED/i.test(message)) {
    return `${message} — Disconnect and reconnect to grant the latest OAuth scopes (ORDERS_READ, ITEMS_READ, INVENTORY_READ).`;
  }
  return message;
}

export default async function DashboardPage() {
  const session = await getSession();

  if (!session.accessToken) {
    redirect("/");
  }

  const client = createSellerClient(session.accessToken);

  let points: Awaited<
    ReturnType<typeof fetchDailyNetSalesLast30Days>
  >["points"] = [];
  let source: "reporting" | "orders" | null = null;
  let salesError: string | null = null;

  let inventoryReport: InventoryHealthReport | null = null;
  let inventoryError: string | null = null;

  try {
    const result = await fetchDailyNetSalesLast30Days(client);
    points = result.points;
    source = result.source;
  } catch (err) {
    salesError = scopeHint(
      err instanceof Error ? err.message : "Failed to load sales data",
    );
  }

  try {
    inventoryReport = await fetchInventoryHealth(client);
  } catch (err) {
    inventoryError = scopeHint(
      err instanceof Error ? err.message : "Failed to load inventory",
    );
  }

  const summary = summarizeSales(points);

  return (
    <div className="min-h-full bg-[#f6f3ee] text-stone-900">
      <header className="border-b border-stone-300/70 bg-[#faf8f5]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-teal-800">
              Square BI Light
            </p>
            <h1 className="mt-1 font-serif text-2xl tracking-tight">
              {session.businessName ?? "Merchant home"}
            </h1>
          </div>
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="rounded-md border border-stone-400 px-3 py-1.5 text-sm text-stone-700 transition hover:bg-stone-200/60"
            >
              Disconnect
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <section className="mb-8">
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
        </section>

        {salesError ? (
          <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
            {salesError}
          </div>
        ) : (
          <>
            <div className="mb-8 grid gap-4 sm:grid-cols-3">
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

            <section className="rounded-lg border border-stone-300/80 bg-white px-4 py-5 sm:px-6">
              <SalesChart points={points} />
              {points.length === 0 || points.every((p) => p.netSales === 0) ? (
                <p className="mt-4 text-sm text-stone-500">
                  No completed orders in the last 30 days. In the Sandbox Seller
                  Dashboard, take a few test payments (Virtual Terminal or POS),
                  then refresh this page.
                </p>
              ) : null}
            </section>

            <section className="mt-8 overflow-hidden rounded-lg border border-stone-300/80 bg-white">
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
            </section>
          </>
        )}

        <InventoryHealth
          report={
            inventoryReport ?? {
              items: [],
              trackedCount: 0,
              outOfStock: [],
              lowStock: [],
              slowMovers: [],
              cards: [],
            }
          }
          error={inventoryError}
        />

        <p className="mt-10 text-sm text-stone-500">
          Tip: after adding OAuth scopes, disconnect and reconnect once.{" "}
          <Link href="/" className="text-teal-800 underline-offset-2 hover:underline">
            Back to connect
          </Link>
        </p>
      </main>
    </div>
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
