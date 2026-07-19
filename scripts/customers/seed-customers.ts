/**
 * Seeds a small pool of Customer profiles, so orders/payments can be
 * attributed to a buyer instead of being entirely anonymous walk-ins.
 * seed-orders.ts attaches a random customer to most (not all) orders —
 * real retail data is a mix of known customers and anonymous sales.
 *
 * Usage: npm run seed:customers
 */
import { createScriptClient } from "../lib/client";
import { idempotencyKey } from "../lib/random";
import { info, logSquareError, step, success } from "../lib/log";

type SeedCustomer = {
  referenceId: string;
  givenName: string;
  familyName: string;
  emailAddress: string;
  phoneNumber: string;
};

const SEED_CUSTOMERS: SeedCustomer[] = [
  { referenceId: "sbi-cust-1", givenName: "Riley", familyName: "Chen", emailAddress: "riley.chen@example.com", phoneNumber: "+14155550101" },
  { referenceId: "sbi-cust-2", givenName: "Sam", familyName: "Okafor", emailAddress: "sam.okafor@example.com", phoneNumber: "+14155550102" },
  { referenceId: "sbi-cust-3", givenName: "Priya", familyName: "Patel", emailAddress: "priya.patel@example.com", phoneNumber: "+14155550103" },
  { referenceId: "sbi-cust-4", givenName: "Marcus", familyName: "Lee", emailAddress: "marcus.lee@example.com", phoneNumber: "+14155550104" },
  { referenceId: "sbi-cust-5", givenName: "Ines", familyName: "Torres", emailAddress: "ines.torres@example.com", phoneNumber: "+14155550105" },
  { referenceId: "sbi-cust-6", givenName: "Dylan", familyName: "Murphy", emailAddress: "dylan.murphy@example.com", phoneNumber: "+14155550106" },
  { referenceId: "sbi-cust-7", givenName: "Hana", familyName: "Suzuki", emailAddress: "hana.suzuki@example.com", phoneNumber: "+14155550107" },
  { referenceId: "sbi-cust-8", givenName: "Omar", familyName: "Farouk", emailAddress: "omar.farouk@example.com", phoneNumber: "+14155550108" },
  { referenceId: "sbi-cust-9", givenName: "Grace", familyName: "Kim", emailAddress: "grace.kim@example.com", phoneNumber: "+14155550109" },
  { referenceId: "sbi-cust-10", givenName: "Leo", familyName: "Novak", emailAddress: "leo.novak@example.com", phoneNumber: "+14155550110" },
];

async function main() {
  const client = createScriptClient();

  step("Checking for existing seed customers");
  const existingByReferenceId = new Set<string>();
  const page = await client.customers.list({});
  for await (const customer of page) {
    if (customer.referenceId) existingByReferenceId.add(customer.referenceId);
  }

  let created = 0;
  for (const seedCustomer of SEED_CUSTOMERS) {
    if (existingByReferenceId.has(seedCustomer.referenceId)) {
      info(`Customer ${seedCustomer.givenName} ${seedCustomer.familyName} already exists.`);
      continue;
    }

    try {
      await client.customers.create({
        idempotencyKey: idempotencyKey(),
        referenceId: seedCustomer.referenceId,
        givenName: seedCustomer.givenName,
        familyName: seedCustomer.familyName,
        emailAddress: seedCustomer.emailAddress,
        phoneNumber: seedCustomer.phoneNumber,
      });
      created += 1;
      info(`Created ${seedCustomer.givenName} ${seedCustomer.familyName}.`);
    } catch (error) {
      logSquareError(`Failed to create customer ${seedCustomer.givenName} ${seedCustomer.familyName}`, error);
    }
  }

  success(`Created ${created} new customer(s). Run \`npm run seed:orders\` next to attach them to orders.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logSquareError("Customer seed failed", error);
    process.exit(1);
  });
}

export { main };
