/**
 * Exercises the Payments API beyond what seed-orders.ts already covers:
 *  1. Pays off any OPEN orders still sitting in the account (e.g. the ones
 *     seed-orders.ts intentionally left open).
 *  2. Records a few standalone custom-amount payments not tied to an order
 *     (catering deposits, invoice payments) — useful for testing flows that
 *     aren't pure point-of-sale.
 *  3. Issues one sample refund, so refund handling has real data too.
 *
 * Usage: npm run seed:payments
 */
import type { Payment, SquareClient } from "square";
import { createScriptClient, listLocationIds } from "../lib/client";
import { findOpenOrders, payOrderInFull } from "../lib/orders";
import { listActiveTeamMemberIds } from "../lib/team";
import { listCustomerIds } from "../lib/customers";
import { idempotencyKey, randomChoice, randomInt } from "../lib/random";
import { info, logSquareError, step, success, warn } from "../lib/log";

const CUSTOM_PAYMENTS = [
  { note: "Catering order deposit", amountCents: 15000 },
  { note: "Private event advance payment", amountCents: 22500 },
  { note: "Invoice #SBI-1042 payment", amountCents: 8400 },
];

async function main() {
  const client = createScriptClient();
  const locationIds = await listLocationIds(client);

  const teamMemberIds = await listActiveTeamMemberIds(client);
  if (teamMemberIds.length === 0) {
    warn(
      "No active team members found — payments will be created without a team_member_id. " +
        "Run `npm run seed:team` first to attribute sales to staff.",
    );
  }
  const pickTeamMember = () => (teamMemberIds.length > 0 ? randomChoice(teamMemberIds) : undefined);

  const customerIds = await listCustomerIds(client);
  if (customerIds.length === 0) {
    warn(
      "No customers found — the standalone deposit/invoice payments will have no customer_id. " +
        "Run `npm run seed:customers` first to attribute them to a buyer.",
    );
  }
  const pickCustomer = () => (customerIds.length > 0 ? randomChoice(customerIds) : undefined);

  step("Paying off any open orders");
  const openOrders = await findOpenOrders(client, locationIds);
  info(`Found ${openOrders.length} open order(s).`);

  let paidCount = 0;
  const completedPayments: Payment[] = [];
  for (const order of openOrders) {
    try {
      const payment = await payOrderInFull(client, order, pickTeamMember());
      if (payment) {
        paidCount += 1;
        completedPayments.push(payment);
      }
    } catch (error) {
      logSquareError(`Failed to pay order ${order.id}`, error);
    }
  }
  success(`Completed ${paidCount}/${openOrders.length} open order(s).`);

  step("Recording standalone custom-amount payments");
  for (const custom of CUSTOM_PAYMENTS) {
    try {
      const locationId = locationIds[randomInt(0, locationIds.length - 1)];
      const payment = await createCustomPayment(
        client,
        locationId,
        custom.amountCents,
        custom.note,
        pickTeamMember(),
        pickCustomer(),
      );
      if (payment) completedPayments.push(payment);
      info(`Recorded "${custom.note}" — $${(custom.amountCents / 100).toFixed(2)}.`);
    } catch (error) {
      logSquareError(`Failed to record payment "${custom.note}"`, error);
    }
  }

  step("Issuing a sample refund");
  const refundable = completedPayments.find((p) => Number(p.amountMoney?.amount ?? 0) > 0);
  if (!refundable) {
    warn("No completed payments available to refund — skipping.");
  } else {
    await issueSampleRefund(client, refundable);
  }

  success("Payments seed complete.");
}

async function createCustomPayment(
  client: SquareClient,
  locationId: string,
  amountCents: number,
  note: string,
  teamMemberId?: string,
  customerId?: string,
): Promise<Payment | null> {
  const response = await client.payments.create({
    idempotencyKey: idempotencyKey(),
    sourceId: "CASH",
    locationId,
    amountMoney: { amount: BigInt(amountCents), currency: "USD" },
    cashDetails: {
      buyerSuppliedMoney: { amount: BigInt(amountCents), currency: "USD" },
    },
    note,
    teamMemberId,
    customerId,
    autocomplete: true,
  });
  return response.payment ?? null;
}

async function issueSampleRefund(client: SquareClient, payment: Payment) {
  const total = Number(payment.amountMoney?.amount ?? 0);
  if (!payment.id || total <= 0) return;

  const refundCents = Math.max(1, Math.floor(total * 0.25));

  try {
    await client.refunds.refundPayment({
      idempotencyKey: idempotencyKey(),
      paymentId: payment.id,
      amountMoney: { amount: BigInt(refundCents), currency: "USD" },
      reason: "Sample refund seeded for testing",
    });
    success(`Refunded $${(refundCents / 100).toFixed(2)} against payment ${payment.id}.`);
  } catch (error) {
    logSquareError(`Failed to refund payment ${payment.id}`, error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logSquareError("Payments seed failed", error);
    process.exit(1);
  });
}

export { main };
