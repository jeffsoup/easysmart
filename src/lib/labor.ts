import type { SquareClient, Timecard } from "square";

const LOOKBACK_DAYS = 30;
/** Soft benchmark for labor cost as a share of net sales (SMB rule of thumb). */
const LABOR_COST_WARN_PCT = 30;

export type LaborInsightReport = {
  lookbackDays: number;
  timecardCount: number;
  laborHours: number;
  estimatedLaborCost: number;
  netSales: number;
  salesPerLaborHour: number | null;
  laborCostPctOfSales: number | null;
  cards: string[];
  hasWageData: boolean;
};

/**
 * Labor / payroll-adjacent insights from Team + Labor timecards.
 * Not full payroll runs — estimated cost from timecard hourly rates × hours.
 */
export async function fetchLaborInsights(
  client: SquareClient,
  netSales: number,
): Promise<LaborInsightReport> {
  const locations = await client.locations.list();
  const locationIds = (locations.locations ?? [])
    .map((location) => location.id)
    .filter((id): id is string => Boolean(id));

  if (locationIds.length === 0) {
    return emptyReport(netSales, [
      "No locations found — labor insights need at least one Square location.",
    ]);
  }

  const timecards = await searchClosedTimecards(client, locationIds);
  let laborHours = 0;
  let laborCostCents = 0;
  let wageBearingHours = 0;

  for (const timecard of timecards) {
    const hours = workedHours(timecard);
    if (hours <= 0) continue;
    laborHours += hours;

    const rateCents = Number(timecard.wage?.hourlyRate?.amount ?? 0);
    if (rateCents > 0) {
      laborCostCents += rateCents * hours;
      wageBearingHours += hours;
    }
  }

  laborHours = round1(laborHours);
  const estimatedLaborCost = round2(laborCostCents / 100);
  const hasWageData = wageBearingHours > 0;
  const salesPerLaborHour =
    laborHours > 0 ? round2(netSales / laborHours) : null;
  const laborCostPctOfSales =
    hasWageData && netSales > 0
      ? round1((estimatedLaborCost / netSales) * 100)
      : null;

  return {
    lookbackDays: LOOKBACK_DAYS,
    timecardCount: timecards.length,
    laborHours,
    estimatedLaborCost,
    netSales,
    salesPerLaborHour,
    laborCostPctOfSales,
    hasWageData,
    cards: buildCards({
      timecardCount: timecards.length,
      laborHours,
      estimatedLaborCost,
      salesPerLaborHour,
      laborCostPctOfSales,
      hasWageData,
      netSales,
    }),
  };
}

function emptyReport(
  netSales: number,
  cards: string[],
): LaborInsightReport {
  return {
    lookbackDays: LOOKBACK_DAYS,
    timecardCount: 0,
    laborHours: 0,
    estimatedLaborCost: 0,
    netSales,
    salesPerLaborHour: null,
    laborCostPctOfSales: null,
    hasWageData: false,
    cards,
  };
}

async function searchClosedTimecards(
  client: SquareClient,
  locationIds: string[],
): Promise<Timecard[]> {
  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - (LOOKBACK_DAYS - 1));
  start.setUTCHours(0, 0, 0, 0);

  const timecards: Timecard[] = [];
  let cursor: string | undefined;

  do {
    const page = await client.labor.searchTimecards({
      cursor,
      limit: 200,
      query: {
        filter: {
          locationIds,
          status: "CLOSED",
          start: {
            startAt: start.toISOString(),
            endAt: end.toISOString(),
          },
        },
      },
    });

    timecards.push(...(page.timecards ?? []));
    cursor = page.cursor;
  } while (cursor);

  return timecards;
}

function workedHours(timecard: Timecard): number {
  if (!timecard.endAt) return 0;
  let ms =
    new Date(timecard.endAt).getTime() - new Date(timecard.startAt).getTime();

  for (const brk of timecard.breaks ?? []) {
    if (brk.isPaid || !brk.endAt) continue;
    ms -= new Date(brk.endAt).getTime() - new Date(brk.startAt).getTime();
  }

  return Math.max(0, ms / (1000 * 60 * 60));
}

function buildCards(input: {
  timecardCount: number;
  laborHours: number;
  estimatedLaborCost: number;
  salesPerLaborHour: number | null;
  laborCostPctOfSales: number | null;
  hasWageData: boolean;
  netSales: number;
}): string[] {
  if (input.timecardCount === 0) {
    return [
      `No closed timecards in the last ${LOOKBACK_DAYS} days. Clock team members in/out in the Sandbox Dashboard (Team → Timecards) to populate labor insights.`,
    ];
  }

  const cards: string[] = [];

  if (input.salesPerLaborHour != null) {
    cards.push(
      `Sales per labor hour: ${formatMoney(input.salesPerLaborHour)} across ${formatHours(input.laborHours)} hours worked.`,
    );
  } else {
    cards.push(
      `${formatHours(input.laborHours)} labor hours logged, but net sales are $0 for the period — SPLH is unavailable.`,
    );
  }

  if (input.hasWageData && input.laborCostPctOfSales != null) {
    const tone =
      input.laborCostPctOfSales > LABOR_COST_WARN_PCT
        ? `Above a common ${LABOR_COST_WARN_PCT}% SMB benchmark — worth a closer look.`
        : `Within a common ${LABOR_COST_WARN_PCT}% SMB benchmark.`;
    cards.push(
      `Estimated labor cost ${formatMoney(input.estimatedLaborCost)} is ${input.laborCostPctOfSales}% of net sales. ${tone}`,
    );
  } else {
    cards.push(
      "Timecards are missing hourly wage rates, so labor cost % can’t be estimated yet. Set wages on team member jobs in Square Team settings.",
    );
  }

  return cards;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatHours(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
