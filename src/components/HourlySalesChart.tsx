import type { HourlyNetSalesPoint } from "@/lib/reporting";

type Props = {
  points: HourlyNetSalesPoint[];
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function HourlySalesChart({ points }: Props) {
  const max = Math.max(...points.map((p) => p.netSales), 1);
  const width = 720;
  const height = 250;
  const padLeft = 52;
  const padRight = 16;
  const padTop = 28;
  const padBottom = 40;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;
  const gap = chartW / Math.max(points.length, 1);
  const barW = Math.max(6, gap * 0.7);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    ratio,
    value: max * ratio,
    y: padTop + chartH - ratio * chartH,
  }));

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-64 w-full min-w-[480px]"
        role="img"
        aria-label="Net sales by hour of day for the last 30 days"
      >
        {yTicks.map((tick) => (
          <g key={tick.ratio}>
            <line
              x1={padLeft}
              y1={tick.y}
              x2={width - padRight}
              y2={tick.y}
              stroke="currentColor"
              className={
                tick.ratio === 0 ? "text-stone-400" : "text-stone-200"
              }
              strokeWidth={tick.ratio === 0 ? 1 : 0.75}
            />
            <text
              x={padLeft - 8}
              y={tick.y + 3}
              textAnchor="end"
              className="fill-stone-500 text-[10px]"
            >
              {formatCurrency(tick.value)}
            </text>
          </g>
        ))}

        {points.map((p, i) => {
          const x = padLeft + i * gap + (gap - barW) / 2;
          const h = (p.netSales / max) * chartH;
          const y = padTop + chartH - h;
          const showLabel = p.hour % 3 === 0;
          const centerX = padLeft + i * gap + gap / 2;

          return (
            <g key={p.hour}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(h, 0)}
                className="fill-teal-700/85"
                rx={2}
              >
                <title>{`${p.label}: ${formatCurrency(p.netSales)}`}</title>
              </rect>
              <line
                x1={centerX}
                y1={padTop + chartH}
                x2={centerX}
                y2={padTop + chartH + (showLabel ? 5 : 3)}
                stroke="currentColor"
                className="text-stone-400"
                strokeWidth={1}
              />
              {showLabel ? (
                <text
                  x={centerX}
                  y={height - 12}
                  textAnchor="middle"
                  className="fill-stone-500 text-[10px]"
                >
                  {p.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
