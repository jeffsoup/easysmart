"use client";

import { useState } from "react";
import type { DailyNetSalesPoint } from "@/lib/reporting";

type Props = {
  points: DailyNetSalesPoint[];
  onSelectDay?: (date: string) => void;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateLabel(isoDate: string) {
  const [, month, day] = isoDate.split("-");
  if (!month || !day) return isoDate;
  return `${Number(month)}/${Number(day)}`;
}

export function SalesChart({ points, onSelectDay }: Props) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const max = Math.max(...points.map((p) => p.netSales), 1);
  const width = 720;
  const height = 250;
  const padLeft = 52;
  const padRight = 16;
  const padTop = 28;
  const padBottom = 40;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;
  const gap = points.length > 1 ? chartW / points.length : chartW;
  const barW = Math.max(4, gap * 0.62);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    ratio,
    value: max * ratio,
    y: padTop + chartH - ratio * chartH,
  }));

  const labelEvery = points.length > 20 ? 5 : points.length > 10 ? 3 : 2;
  const hovered = points.find((p) => p.date === hoveredDate) ?? null;

  const path = points
    .map((p, i) => {
      const x = padLeft + i * gap + gap / 2;
      const y = padTop + chartH - (p.netSales / max) * chartH;
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-64 w-full min-w-[480px]"
        role="img"
        aria-label="Daily net sales for the last 30 days. Click a day for hourly detail."
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
          const showLabel =
            i === 0 || i === points.length - 1 || i % labelEvery === 0;
          const centerX = padLeft + i * gap + gap / 2;
          const isHovered = hoveredDate === p.date;

          return (
            <g key={p.date}>
              <rect
                x={padLeft + i * gap}
                y={padTop}
                width={gap}
                height={chartH}
                className="fill-transparent cursor-pointer"
                focusable={onSelectDay ? "true" : undefined}
                onMouseEnter={() => setHoveredDate(p.date)}
                onMouseLeave={() => setHoveredDate(null)}
                onFocus={() => setHoveredDate(p.date)}
                onBlur={() => setHoveredDate(null)}
                onClick={() => onSelectDay?.(p.date)}
                role={onSelectDay ? "button" : undefined}
                tabIndex={onSelectDay ? 0 : undefined}
                aria-label={`${p.date}: ${formatCurrency(p.netSales)}. Click for hourly breakdown.`}
                onKeyDown={(event) => {
                  if (!onSelectDay) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectDay(p.date);
                  }
                }}
              />
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(h, 0)}
                className={
                  isHovered
                    ? "fill-teal-800 pointer-events-none"
                    : "fill-teal-700/85 pointer-events-none"
                }
                rx={2}
              />
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
                  {formatDateLabel(p.date)}
                </text>
              ) : null}
            </g>
          );
        })}

        {points.length > 1 ? (
          <path
            d={path}
            fill="none"
            className="stroke-amber-800 pointer-events-none"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        ) : null}

        {hovered
          ? (() => {
              const index = points.findIndex((p) => p.date === hovered.date);
              const tipX = Math.min(
                Math.max(padLeft + index * gap + gap / 2, padLeft + 54),
                width - padRight - 54,
              );
              return (
                <g pointerEvents="none">
                  <rect
                    x={tipX - 54}
                    y={8}
                    width={108}
                    height={34}
                    rx={4}
                    className="fill-stone-900/90"
                  />
                  <text
                    x={tipX}
                    y={22}
                    textAnchor="middle"
                    className="fill-white text-[11px] font-medium"
                  >
                    {formatDateLabel(hovered.date)}
                  </text>
                  <text
                    x={tipX}
                    y={36}
                    textAnchor="middle"
                    className="fill-stone-200 text-[10px]"
                  >
                    {formatCurrency(hovered.netSales)} · click
                  </text>
                </g>
              );
            })()
          : null}
      </svg>
    </div>
  );
}
