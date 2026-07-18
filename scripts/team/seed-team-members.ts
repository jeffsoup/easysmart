/**
 * Seeds Jobs and Team Members with wage settings, so Labor / payroll-adjacent
 * insights (sales per labor hour, labor cost % of sales) have real team
 * members and hourly rates to work with once timecards are seeded.
 *
 * Usage: npm run seed:team
 */
import type { Job, SquareClient } from "square";
import { createScriptClient } from "../lib/client";
import { idempotencyKey } from "../lib/random";
import { info, logSquareError, step, success } from "../lib/log";

type SeedJob = {
  title: string;
  isTipEligible: boolean;
};

type SeedTeamMember = {
  referenceId: string;
  givenName: string;
  familyName: string;
  email: string;
  jobTitle: string;
  payType: "HOURLY" | "SALARY";
  hourlyRateCents?: number;
  annualRateCents?: number;
};

const SEED_JOBS: SeedJob[] = [
  { title: "Barista", isTipEligible: true },
  { title: "Cashier", isTipEligible: true },
  { title: "Shift Lead", isTipEligible: true },
  { title: "Store Manager", isTipEligible: false },
];

const SEED_TEAM_MEMBERS: SeedTeamMember[] = [
  { referenceId: "sbi-team-1", givenName: "Jordan", familyName: "Rivera", email: "jordan.rivera@example.com", jobTitle: "Barista", payType: "HOURLY", hourlyRateCents: 1750 },
  { referenceId: "sbi-team-2", givenName: "Casey", familyName: "Nguyen", email: "casey.nguyen@example.com", jobTitle: "Barista", payType: "HOURLY", hourlyRateCents: 1750 },
  { referenceId: "sbi-team-3", givenName: "Morgan", familyName: "Blake", email: "morgan.blake@example.com", jobTitle: "Cashier", payType: "HOURLY", hourlyRateCents: 1600 },
  { referenceId: "sbi-team-4", givenName: "Alex", familyName: "Kim", email: "alex.kim@example.com", jobTitle: "Shift Lead", payType: "HOURLY", hourlyRateCents: 2100 },
  { referenceId: "sbi-team-5", givenName: "Taylor", familyName: "Reyes", email: "taylor.reyes@example.com", jobTitle: "Store Manager", payType: "SALARY", annualRateCents: 5800000 },
];

async function main() {
  const client = createScriptClient();

  step("Ensuring jobs exist");
  const jobIdByTitle = await ensureJobs(client);

  step("Ensuring team members exist");
  await ensureTeamMembers(client, jobIdByTitle);

  success("Team seed complete. Run `npm run seed:payroll` next to add timecards.");
}

async function ensureJobs(client: SquareClient): Promise<Map<string, string>> {
  const jobIdByTitle = new Map<string, string>();

  let cursor: string | undefined;
  do {
    const response = await client.team.listJobs({ cursor });
    for (const job of response.jobs ?? []) {
      if (job.title && job.id) jobIdByTitle.set(job.title, job.id);
    }
    cursor = response.cursor;
  } while (cursor);

  for (const seedJob of SEED_JOBS) {
    if (jobIdByTitle.has(seedJob.title)) {
      info(`Job "${seedJob.title}" already exists.`);
      continue;
    }

    try {
      const response = await client.team.createJob({
        idempotencyKey: idempotencyKey(),
        job: { title: seedJob.title, isTipEligible: seedJob.isTipEligible },
      });
      const job: Job | undefined = response.job;
      if (job?.id && job.title) {
        jobIdByTitle.set(job.title, job.id);
        info(`Created job "${job.title}".`);
      }
    } catch (error) {
      logSquareError(`Failed to create job "${seedJob.title}"`, error);
    }
  }

  return jobIdByTitle;
}

async function ensureTeamMembers(client: SquareClient, jobIdByTitle: Map<string, string>) {
  const existingByReferenceId = new Set<string>();
  let cursor: string | undefined;
  do {
    const response = await client.teamMembers.search({ cursor, limit: 100 });
    for (const member of response.teamMembers ?? []) {
      if (member.referenceId) existingByReferenceId.add(member.referenceId);
    }
    cursor = response.cursor;
  } while (cursor);

  let created = 0;
  for (const seedMember of SEED_TEAM_MEMBERS) {
    if (existingByReferenceId.has(seedMember.referenceId)) {
      info(`Team member ${seedMember.givenName} ${seedMember.familyName} already exists.`);
      continue;
    }

    const jobId = jobIdByTitle.get(seedMember.jobTitle);
    if (!jobId) {
      info(`Skipping ${seedMember.givenName} ${seedMember.familyName} — job "${seedMember.jobTitle}" not found.`);
      continue;
    }

    try {
      // Square rejects CreateTeamMember when wageSetting is included inline
      // unless the member already has a permission set — and permission sets
      // can only be assigned from the Dashboard, not the API. Creating the
      // member bare first gets it a default permission set automatically;
      // the dedicated wageSetting.update endpoint then attaches the wage
      // without hitting that check.
      const createResponse = await client.teamMembers.create({
        idempotencyKey: idempotencyKey(),
        teamMember: {
          referenceId: seedMember.referenceId,
          givenName: seedMember.givenName,
          familyName: seedMember.familyName,
          emailAddress: seedMember.email,
          status: "ACTIVE",
          assignedLocations: { assignmentType: "ALL_CURRENT_AND_FUTURE_LOCATIONS" },
        },
      });

      const teamMemberId = createResponse.teamMember?.id;
      if (!teamMemberId) {
        throw new Error("Team member create returned no ID.");
      }

      await client.teamMembers.wageSetting.update({
        teamMemberId,
        wageSetting: {
          isOvertimeExempt: seedMember.payType === "SALARY",
          jobAssignments: [
            seedMember.payType === "HOURLY"
              ? {
                  jobId,
                  payType: "HOURLY",
                  hourlyRate: { amount: BigInt(seedMember.hourlyRateCents ?? 0), currency: "USD" },
                }
              : {
                  jobId,
                  payType: "SALARY",
                  annualRate: { amount: BigInt(seedMember.annualRateCents ?? 0), currency: "USD" },
                  weeklyHours: 40,
                },
          ],
        },
      });

      created += 1;
      info(`Created ${seedMember.givenName} ${seedMember.familyName} (${seedMember.jobTitle}).`);
    } catch (error) {
      logSquareError(`Failed to create team member ${seedMember.givenName} ${seedMember.familyName}`, error);
    }
  }

  success(`Created ${created} new team member(s).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logSquareError("Team seed failed", error);
    process.exit(1);
  });
}

export { main, SEED_TEAM_MEMBERS };
