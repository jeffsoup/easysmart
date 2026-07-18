import type { SquareClient, Timecard } from "square";
import {
  fetchSalesByTeamMember,
  type TeamSalesReport,
} from "./teamSales";

const LOOKBACK_DAYS = 30;
/** Soft benchmark for labor cost as a share of net sales (SMB rule of thumb). */
const LABOR_COST_WARN_PCT = 30;

export type LaborTimecardRow = {
  id: string;
  teamMemberId: string;
  teamMemberName: string;
  jobTitle: string | null;
  startAt: string;
  endAt: string | null;
  workDate: string;
  hours: number;
  hourlyRate: number | null;
  laborCost: number | null;
};

export type LaborTeamMemberRow = {
  teamMemberId: string;
  teamMemberName: string;
  timecardCount: number;
  hours: number;
  laborCost: number | null;
  hoursSharePct: number;
  costSharePct: number | null;
};

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
  timecards: LaborTimecardRow[];
  byTeamMember: LaborTeamMemberRow[];
  /** Item sales attributed via Payments.team_member_id → Orders. */
  teamSales: TeamSalesReport;
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
  const timeZone = locations.locations?.[0]?.timezone?.trim() || "UTC";

  if (locationIds.length === 0) {
    return emptyReport(netSales, [
      "No locations found — labor insights need at least one Square location.",
    ]);
  }

  const [timecards, nameById] = await Promise.all([
    searchClosedTimecards(client, locationIds),
    loadTeamMemberNames(client, locationIds),
  ]);

  const teamSalesPromise = fetchSalesByTeamMember(client, nameById);

  const rows: LaborTimecardRow[] = [];
  let laborHours = 0;
  let laborCostCents = 0;
  let wageBearingHours = 0;

  for (const timecard of timecards) {
    const hours = workedHours(timecard);
    if (hours <= 0) continue;

    laborHours += hours;
    const rateCents = Number(timecard.wage?.hourlyRate?.amount ?? 0);
    const hasRate = rateCents > 0;
    if (hasRate) {
      laborCostCents += rateCents * hours;
      wageBearingHours += hours;
    }

    rows.push({
      id: timecard.id ?? `${timecard.teamMemberId}-${timecard.startAt}`,
      teamMemberId: timecard.teamMemberId,
      teamMemberName:
        nameById.get(timecard.teamMemberId) ?? "Unknown team member",
      jobTitle: timecard.wage?.title?.trim() || null,
      startAt: timecard.startAt,
      endAt: timecard.endAt ?? null,
      workDate: dateInZone(timecard.startAt, timeZone),
      hours: round1(hours),
      hourlyRate: hasRate ? round2(rateCents / 100) : null,
      laborCost: hasRate ? round2((rateCents * hours) / 100) : null,
    });
  }

  rows.sort((a, b) => b.startAt.localeCompare(a.startAt));

  laborHours = round1(laborHours);
  const estimatedLaborCost = round2(laborCostCents / 100);
  const hasWageData = wageBearingHours > 0;
  const salesPerLaborHour =
    laborHours > 0 ? round2(netSales / laborHours) : null;
  const laborCostPctOfSales =
    hasWageData && netSales > 0
      ? round1((estimatedLaborCost / netSales) * 100)
      : null;

  const byTeamMember = aggregateByTeamMember(
    rows,
    laborHours,
    estimatedLaborCost,
    hasWageData,
  );
  const teamSales = await teamSalesPromise;

  const cards = buildCards({
    timecardCount: rows.length,
    laborHours,
    estimatedLaborCost,
    salesPerLaborHour,
    laborCostPctOfSales,
    hasWageData,
    netSales,
  });

  if (teamSales.byTeamMember.length > 0) {
    const top = teamSales.byTeamMember[0];
    cards.push(
      `Attributed item sales: ${formatMoney(teamSales.attributedSales)} across ${teamSales.byTeamMember.length} team member${teamSales.byTeamMember.length === 1 ? "" : "s"} (via POS payment attribution). Top: ${top.teamMemberName} (${formatMoney(top.netSales)}).`,
    );
  } else if (teamSales.unattributedPaymentCount > 0) {
    cards.push(
      `${teamSales.unattributedPaymentCount} completed payment${teamSales.unattributedPaymentCount === 1 ? "" : "s"} had no team member on the payment — attributed sales require staff logged into POS.`,
    );
  }

  return {
    lookbackDays: LOOKBACK_DAYS,
    timecardCount: rows.length,
    laborHours,
    estimatedLaborCost,
    netSales,
    salesPerLaborHour,
    laborCostPctOfSales,
    hasWageData,
    timecards: rows,
    byTeamMember,
    teamSales,
    cards,
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
    timecards: [],
    byTeamMember: [],
    teamSales: {
      lookbackDays: LOOKBACK_DAYS,
      attributedSales: 0,
      unattributedPaymentCount: 0,
      attributedOrderCount: 0,
      byTeamMember: [],
    },
    cards,
  };
}

function aggregateByTeamMember(
  rows: LaborTimecardRow[],
  totalHours: number,
  totalCost: number,
  hasWageData: boolean,
): LaborTeamMemberRow[] {
  const map = new Map<
    string,
    {
      teamMemberId: string;
      teamMemberName: string;
      timecardCount: number;
      hours: number;
      laborCost: number;
      hasCost: boolean;
    }
  >();

  for (const row of rows) {
    const current = map.get(row.teamMemberId) ?? {
      teamMemberId: row.teamMemberId,
      teamMemberName: row.teamMemberName,
      timecardCount: 0,
      hours: 0,
      laborCost: 0,
      hasCost: false,
    };
    current.timecardCount += 1;
    current.hours += row.hours;
    if (row.laborCost != null) {
      current.laborCost += row.laborCost;
      current.hasCost = true;
    }
    map.set(row.teamMemberId, current);
  }

  return [...map.values()]
    .map((row) => ({
      teamMemberId: row.teamMemberId,
      teamMemberName: row.teamMemberName,
      timecardCount: row.timecardCount,
      hours: round1(row.hours),
      laborCost: row.hasCost ? round2(row.laborCost) : null,
      hoursSharePct:
        totalHours > 0 ? round1((row.hours / totalHours) * 100) : 0,
      costSharePct:
        hasWageData && totalCost > 0 && row.hasCost
          ? round1((row.laborCost / totalCost) * 100)
          : null,
    }))
    .sort((a, b) => b.hours - a.hours);
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

async function loadTeamMemberNames(
  client: SquareClient,
  locationIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  let cursor: string | undefined;

  do {
    const page = await client.teamMembers.search({
      cursor,
      limit: 100,
      query: {
        filter: {
          locationIds,
        },
      },
    });

    for (const member of page.teamMembers ?? []) {
      if (!member.id) continue;
      const given = member.givenName?.trim() ?? "";
      const family = member.familyName?.trim() ?? "";
      const name = [given, family].filter(Boolean).join(" ") || "Team member";
      names.set(member.id, name);
    }
    cursor = page.cursor;
  } while (cursor);

  return names;
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

function dateInZone(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
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
