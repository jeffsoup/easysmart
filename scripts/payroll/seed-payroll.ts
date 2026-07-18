/**
 * Seeds closed Timecards (shifts) for the last 30 days for each hourly team
 * member created by seed-team-members.ts. This is the data source behind
 * "payroll-adjacent" labor insights (sales per labor hour, labor cost % of
 * net sales) — Square's public API doesn't expose a payroll-run endpoint,
 * so timecards + hourly wages are the closest equivalent (see labor.ts).
 *
 * Unlike Orders, Timecards CAN be backdated (start_at just can't be in the
 * future), so this script produces genuine 30-day history in one run.
 *
 * Usage: npm run seed:payroll [-- --shifts=15]
 */
import type { SquareClient, TeamMember } from "square";
import { createScriptClient, listLocationIds } from "../lib/client";
import { idempotencyKey, randomInt, randomSample, randomTimeDaysAgo } from "../lib/random";
import { info, logSquareError, step, success } from "../lib/log";

const DEFAULT_SHIFTS_PER_MEMBER = 15;
const LOOKBACK_DAYS = 29; // days 1..29 ago; skip "today" to avoid future-time edge cases
const BREAK_TYPE_NAME = "Rest Break";
const BREAK_DURATION_MINUTES = 15;

async function main() {
  const shiftsPerMember = readShiftsArg();
  const client = createScriptClient();
  const locationIds = await listLocationIds(client);

  step("Loading job titles");
  const jobTitleById = await loadJobTitles(client);

  step("Loading hourly team members");
  const members = await loadHourlyTeamMembers(client, jobTitleById);
  if (members.length === 0) {
    throw new Error(
      "No hourly team members found. Run `npm run seed:team` first.",
    );
  }
  info(`Found ${members.length} hourly team member(s).`);

  step("Ensuring a break type exists per location");
  const breakTypeIdByLocation = await ensureBreakTypes(client, locationIds);

  step(`Creating up to ${shiftsPerMember} shifts per team member over the last ${LOOKBACK_DAYS} days`);
  let created = 0;
  let failed = 0;

  for (const member of members) {
    const dayOffsets = randomSample(
      Array.from({ length: LOOKBACK_DAYS }, (_, i) => i + 1),
      shiftsPerMember,
    );

    for (const dayOffset of dayOffsets) {
      const locationId = locationIds[randomInt(0, locationIds.length - 1)];
      try {
        await createTimecard(client, member, locationId, dayOffset, breakTypeIdByLocation.get(locationId));
        created += 1;
      } catch (error) {
        failed += 1;
        logSquareError(`Timecard for ${member.givenName} ${member.familyName} (day -${dayOffset}) failed`, error);
      }
    }
  }

  success(`Created ${created} timecard(s)${failed > 0 ? `, ${failed} failed` : ""}.`);
}

function readShiftsArg(): number {
  const arg = process.argv.find((a) => a.startsWith("--shifts="));
  const value = arg ? Number(arg.split("=")[1]) : DEFAULT_SHIFTS_PER_MEMBER;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_SHIFTS_PER_MEMBER;
}

type HourlyMember = {
  teamMemberId: string;
  givenName: string;
  familyName: string;
  jobTitle: string;
  hourlyRateCents: number;
};

async function loadJobTitles(client: SquareClient): Promise<Map<string, string>> {
  const jobTitleById = new Map<string, string>();
  let cursor: string | undefined;

  do {
    const response = await client.team.listJobs({ cursor });
    for (const job of response.jobs ?? []) {
      if (job.id && job.title) jobTitleById.set(job.id, job.title);
    }
    cursor = response.cursor;
  } while (cursor);

  return jobTitleById;
}

async function loadHourlyTeamMembers(
  client: SquareClient,
  jobTitleById: Map<string, string>,
): Promise<HourlyMember[]> {
  const members: HourlyMember[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.teamMembers.search({
      cursor,
      limit: 100,
      query: { filter: { status: "ACTIVE" } },
    });

    for (const member of response.teamMembers ?? []) {
      const hourly = toHourlyMember(member, jobTitleById);
      if (hourly) members.push(hourly);
    }

    cursor = response.cursor;
  } while (cursor);

  return members;
}

function toHourlyMember(member: TeamMember, jobTitleById: Map<string, string>): HourlyMember | null {
  if (!member.id) return null;
  const assignment = member.wageSetting?.jobAssignments?.find((a) => a.payType === "HOURLY");
  if (!assignment) return null;

  const rate = Number(assignment.hourlyRate?.amount ?? 0);
  if (rate <= 0) return null;

  return {
    teamMemberId: member.id,
    givenName: member.givenName ?? "Team",
    familyName: member.familyName ?? "Member",
    jobTitle: (assignment.jobId && jobTitleById.get(assignment.jobId)) || "Team Member",
    hourlyRateCents: rate,
  };
}

async function ensureBreakTypes(
  client: SquareClient,
  locationIds: string[],
): Promise<Map<string, string>> {
  const breakTypeIdByLocation = new Map<string, string>();

  for (const locationId of locationIds) {
    const page = await client.labor.breakTypes.list({ locationId });
    let existingId: string | undefined;
    for await (const breakType of page) {
      if (breakType.breakName === BREAK_TYPE_NAME && breakType.id) {
        existingId = breakType.id;
        break;
      }
    }

    if (existingId) {
      breakTypeIdByLocation.set(locationId, existingId);
      continue;
    }

    try {
      const response = await client.labor.breakTypes.create({
        idempotencyKey: idempotencyKey(),
        breakType: {
          locationId,
          breakName: BREAK_TYPE_NAME,
          expectedDuration: `PT${BREAK_DURATION_MINUTES}M`,
          isPaid: false,
        },
      });
      if (response.breakType?.id) {
        breakTypeIdByLocation.set(locationId, response.breakType.id);
      }
    } catch (error) {
      logSquareError(`Failed to create break type for location ${locationId}`, error);
    }
  }

  return breakTypeIdByLocation;
}

async function createTimecard(
  client: SquareClient,
  member: HourlyMember,
  locationId: string,
  dayOffset: number,
  breakTypeId: string | undefined,
) {
  const shiftHours = randomInt(4, 8);
  const start = randomTimeDaysAgo(dayOffset, 7, 11);
  const end = new Date(start.getTime() + shiftHours * 60 * 60 * 1000);

  const breaks =
    shiftHours >= 6 && breakTypeId
      ? [buildMidShiftBreak(start, end, breakTypeId)]
      : undefined;

  await client.labor.createTimecard({
    idempotencyKey: idempotencyKey(),
    timecard: {
      locationId,
      teamMemberId: member.teamMemberId,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      status: "CLOSED",
      wage: {
        title: member.jobTitle,
        hourlyRate: { amount: BigInt(member.hourlyRateCents), currency: "USD" },
        tipEligible: true,
      },
      breaks,
    },
  });
}

function buildMidShiftBreak(start: Date, end: Date, breakTypeId: string) {
  const midpoint = new Date((start.getTime() + end.getTime()) / 2);
  const breakEnd = new Date(midpoint.getTime() + BREAK_DURATION_MINUTES * 60 * 1000);
  return {
    breakTypeId,
    name: BREAK_TYPE_NAME,
    expectedDuration: `PT${BREAK_DURATION_MINUTES}M`,
    isPaid: false,
    startAt: midpoint.toISOString(),
    endAt: breakEnd.toISOString(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logSquareError("Payroll seed failed", error);
    process.exit(1);
  });
}

export { main };
