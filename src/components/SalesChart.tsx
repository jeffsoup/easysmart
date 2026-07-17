import type { DailyNetSalesPoint } from "@/lib/reporting";

type Props = {
  points: DailyNetSalesPoint[];
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function SalesChart({ points }: Props) {
  const max = Math.max(...points.map((p) => p.netSales), 1);
  const width = 720;
  const height = 220;
  const padX = 28;
  const padY = 24;
  const chartW = width - padX * 2;
  const chartH = height - padY * 2;
  const gap = points.length > 1 ? chartW / points.length : chartW;
  const barW = Math.max(4, gap * 0.62);

  const path = points
    .map((p, i) => {
      const x = padX + i * gap + gap / 2;
      const y = padY + chartH - (p.netSales / max) * chartH;
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-56 w-full min-w-[480px]"
        role="img"
        aria-label="Daily net sales for the last 30 days"
      >
        <line
          x1={padX}
          y1={padY + chartH}
          x2={width - padX}
          y2={padY + chartH}
          stroke="currentColor"
          className="text-stone-300"
          strokeWidth={1}
        />
        {points.map((p, i) => {
          const x = padX + i * gap + (gap - barW) / 2;
          const h = (p.netSales / max) * chartH;
          const y = padY + chartH - h;
          return (
            <rect
              key={p.date}
              x={x}
              y={y}
              width={barW}
              height={Math.max(h, 0)}
              className="fill-teal-700/85"
              rx={2}
            >
              <title>{`${p.date}: ${formatCurrency(p.netSales)}`}</title>
            </rect>
          );
        })}
        {points.length > 1 ? (
          <path
            d={path}
            fill="none"
            className="stroke-amber-800"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        ) : null}
        <text
          x={padX}
          y={16}
          className="fill-stone-500 text-[11px]"
        >
          Peak day scale {formatCurrency(max)}
        </text>
      </svg>
    </div>
  );
}
