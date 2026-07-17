import type { InventoryHealthReport, InventoryStatus } from "@/lib/inventory";

type Props = {
  report: InventoryHealthReport;
  error?: string | null;
};

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

export function InventoryHealth({ report, error }: Props) {
  const attention = [
    ...report.outOfStock,
    ...report.lowStock,
    ...report.slowMovers,
  ];

  return (
    <section className="mt-14">
      <h2 className="font-serif text-3xl tracking-tight">Inventory health</h2>
      <p className="mt-2 max-w-2xl text-stone-600">
        Stock risk and slow movers from Catalog + Inventory, with sell-through
        from the last 30 days of completed orders.
      </p>

      {error ? (
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Stat label="Tracked variations" value={String(report.trackedCount)} />
            <Stat label="Out of stock" value={String(report.outOfStock.length)} />
            <Stat
              label="Needs attention"
              value={String(report.lowStock.length + report.slowMovers.length)}
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

          {attention.length > 0 ? (
            <div className="mt-8 overflow-hidden rounded-lg border border-stone-300/80 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-stone-200 bg-stone-50 text-stone-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">Item</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">On hand</th>
                    <th className="px-4 py-3 font-medium">Sold (30d)</th>
                    <th className="px-4 py-3 font-medium">Days cover</th>
                  </tr>
                </thead>
                <tbody>
                  {attention.slice(0, 25).map((item) => (
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : report.trackedCount > 0 ? (
            <p className="mt-6 text-sm text-stone-500">
              No out-of-stock, low-stock, or slow-mover flags right now.
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
