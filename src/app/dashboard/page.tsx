import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardTabs } from "@/components/DashboardTabs";
import { InventoryHealth } from "@/components/InventoryHealth";
import { LaborInsights } from "@/components/LaborInsights";
import { NetSalesPanel } from "@/components/NetSalesPanel";
import {
  fetchInventoryHealth,
  type InventoryHealthReport,
} from "@/lib/inventory";
import {
  fetchLaborInsights,
  type LaborInsightReport,
} from "@/lib/labor";
import {
  fetchDailyNetSalesLast30Days,
  summarizeSales,
} from "@/lib/reporting";
import { getSession } from "@/lib/session";
import { createSellerClient } from "@/lib/square";

export const dynamic = "force-dynamic";

function scopeHint(message: string) {
  if (/FORBIDDEN|insufficient|permission|UNAUTHORIZED/i.test(message)) {
    return `${message} — Disconnect and reconnect (open Sandbox Seller Dashboard first) to grant the latest OAuth scopes, including TIMECARDS_READ and EMPLOYEES_READ.`;
  }
  return message;
}

const EMPTY_INVENTORY: InventoryHealthReport = {
  items: [],
  trackedCount: 0,
  outOfStock: [],
  lowStock: [],
  slowMovers: [],
  reorderSuggestions: [],
  cards: [],
};

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

  let laborReport: LaborInsightReport | null = null;
  let laborError: string | null = null;

  try {
    const result = await fetchDailyNetSalesLast30Days(client);
    points = result.points;
    source = result.source;
  } catch (err) {
    salesError = scopeHint(
      err instanceof Error ? err.message : "Failed to load sales data",
    );
  }

  const summary = summarizeSales(points);

  try {
    inventoryReport = await fetchInventoryHealth(client);
  } catch (err) {
    inventoryError = scopeHint(
      err instanceof Error ? err.message : "Failed to load inventory",
    );
  }

  try {
    laborReport = await fetchLaborInsights(client, summary.total);
  } catch (err) {
    laborError = scopeHint(
      err instanceof Error ? err.message : "Failed to load labor insights",
    );
  }

  const emptyLabor: LaborInsightReport = {
    lookbackDays: 30,
    timecardCount: 0,
    laborHours: 0,
    estimatedLaborCost: 0,
    netSales: summary.total,
    salesPerLaborHour: null,
    laborCostPctOfSales: null,
    hasWageData: false,
    cards: [],
  };

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

      <DashboardTabs
        sales={
          <NetSalesPanel
            points={points}
            source={source}
            error={salesError}
            summary={summary}
          />
        }
        inventory={
          <InventoryHealth
            report={inventoryReport ?? EMPTY_INVENTORY}
            error={inventoryError}
          />
        }
        labor={
          <LaborInsights
            report={laborReport ?? emptyLabor}
            error={laborError}
          />
        }
      />

      <div className="mx-auto max-w-5xl px-6 pb-10">
        <p className="text-sm text-stone-500">
          Tip: after adding OAuth scopes, open the Sandbox Seller Dashboard, then
          disconnect and reconnect.{" "}
          <Link href="/" className="text-teal-800 underline-offset-2 hover:underline">
            Back to connect
          </Link>
        </p>
      </div>
    </div>
  );
}
