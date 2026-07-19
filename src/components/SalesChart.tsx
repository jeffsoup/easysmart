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
  const gap = points.length > 1 ? chartW / (points.length - 1) : chartW;
  const baseline = padTop + chartH;

  const coords = points.map((p, i) => {
    const x =
      points.length === 1
        ? padLeft + chartW / 2
        : padLeft + i * gap;
    const y = padTop + chartH - (p.netSales / max) * chartH;
    return { x, y, point: p };
  });

  // Single-day ranges (e.g. Today) still get a visible filled line band.
  const linePath =
    coords.length === 0
      ? ""
      : coords.length === 1
        ? `M ${padLeft} ${coords[0].y} L ${padLeft + chartW} ${coords[0].y}`
        : coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");

  const areaPath =
    coords.length === 0
      ? ""
      : coords.length === 1
        ? [
            `M ${padLeft} ${baseline}`,
            `L ${padLeft} ${coords[0].y}`,
            `L ${padLeft + chartW} ${coords[0].y}`,
            `L ${padLeft + chartW} ${baseline}`,
            "Z",
          ].join(" ")
        : [
            `M ${coords[0].x} ${baseline}`,
            ...coords.map((c) => `L ${c.x} ${c.y}`),
            `L ${coords[coords.length - 1].x} ${baseline}`,
            "Z",
          ].join(" ");

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    ratio,
    value: max * ratio,
    y: padTop + chartH - ratio * chartH,
  }));

  const labelEvery = points.length > 20 ? 5 : points.length > 10 ? 3 : 2;
  const hovered = points.find((p) => p.date === hoveredDate) ?? null;

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-56 w-full min-w-[280px]"
        role="img"
        aria-label="Daily net sales. Click a day for hourly detail."
      >
        <defs>
          <linearGradient id="dailySalesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0f766e" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#0f766e" stopOpacity="0.04" />
          </linearGradient>
        </defs>

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

        {areaPath ? (
          <path d={areaPath} fill="url(#dailySalesFill)" className="pointer-events-none" />
        ) : null}

        {linePath ? (
          <path
            d={linePath}
            fill="none"
            className="stroke-teal-800 pointer-events-none"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}

        {coords.map(({ x, y, point: p }, i) => {
          const showLabel =
            i === 0 || i === points.length - 1 || i % labelEvery === 0;
          const isHovered = hoveredDate === p.date;
          const hitHalf =
            points.length > 1
              ? Math.max(gap / 2, 8)
              : chartW / 2;

          return (
            <g key={p.date}>
              <rect
                x={x - hitHalf}
                y={padTop}
                width={hitHalf * 2}
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
              <circle
                cx={x}
                cy={y}
                r={isHovered ? 4.5 : 3}
                className={
                  isHovered
                    ? "fill-teal-900 pointer-events-none"
                    : "fill-teal-800 pointer-events-none"
                }
              />
              <line
                x1={x}
                y1={baseline}
                x2={x}
                y2={baseline + (showLabel ? 5 : 3)}
                stroke="currentColor"
                className="text-stone-400 pointer-events-none"
                strokeWidth={1}
              />
              {showLabel ? (
                <text
                  x={x}
                  y={height - 12}
                  textAnchor="middle"
                  className="fill-stone-500 text-[10px] pointer-events-none"
                >
                  {formatDateLabel(p.date)}
                </text>
              ) : null}
            </g>
          );
        })}

        {hovered
          ? (() => {
              const index = points.findIndex((p) => p.date === hovered.date);
              const tipX = Math.min(
                Math.max(coords[index]?.x ?? padLeft, padLeft + 54),
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
