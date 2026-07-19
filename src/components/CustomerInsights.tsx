import type { CustomerMetricsReport } from "@/lib/customers";

type Props = {
  report: CustomerMetricsReport;
  error?: string | null;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatNumber(value: number, digits = 1) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: Number.isInteger(value) ? 0 : digits,
  }).format(value);
}

export function CustomerInsights({ report, error }: Props) {
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

  return (
    <section>
      <Header lookbackDays={report.lookbackDays} />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Total customers"
          value={formatNumber(report.totalCustomers, 0)}
          hint="Profiles in your Square customer directory"
        />
        <Stat
          label="Avg payment / customer"
          value={
            report.avgPaymentPerCustomer != null
              ? formatCurrency(report.avgPaymentPerCustomer)
              : "—"
          }
          hint={
            report.payingCustomerCount > 0
              ? `Across ${report.payingCustomerCount} paying customer${report.payingCustomerCount === 1 ? "" : "s"} · last ${report.lookbackDays} days`
              : `No customer-attributed payments in the last ${report.lookbackDays} days`
          }
        />
        <Stat
          label="Avg visits / customer"
          value={
            report.avgVisitsPerCustomer != null
              ? formatNumber(report.avgVisitsPerCustomer)
              : "—"
          }
          hint={
            report.visitingCustomerCount > 0
              ? `${report.visitCount} completed order${report.visitCount === 1 ? "" : "s"} · ${report.visitingCustomerCount} customer${report.visitingCustomerCount === 1 ? "" : "s"} · last ${report.lookbackDays} days`
              : `No customer-attributed orders in the last ${report.lookbackDays} days`
          }
        />
      </div>

      {report.cards.length > 0 ? (
        <ul className="mt-8 space-y-3">
          {report.cards.map((card) => (
            <li
              key={card}
              className="rounded-lg border border-stone-300/80 bg-white px-4 py-3 text-sm text-stone-600"
            >
              {card}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Header({ lookbackDays }: { lookbackDays: number }) {
  return (
    <>
      <h2 className="font-serif text-3xl tracking-tight">Customer insights</h2>
      <p className="mt-2 max-w-2xl text-stone-600">
        Directory size plus spend and visit averages from customer-attributed
        payments and completed orders over the last {lookbackDays} days.
      </p>
    </>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-stone-300/80 bg-white px-4 py-4">
      <p className="text-xs uppercase tracking-[0.12em] text-stone-500">
        {label}
      </p>
      <p className="mt-2 font-serif text-2xl tracking-tight">{value}</p>
      <p className="mt-2 text-xs text-stone-500">{hint}</p>
    </div>
  );
}
