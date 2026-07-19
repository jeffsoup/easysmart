/**
 * Issues full refunds against completed payments that have a customer
 * attached and haven't already been refunded — for testing refund-heavy
 * reporting scenarios (e.g. a spike in refunds for a given day).
 *
 * Refund timestamps are set by Square server-side to "now", same as
 * orders/payments — there's no way to backdate them (see scripts/README.md).
 *
 * Usage: npm run seed:refunds [-- --count=5]
 */
import type { Payment, SquareClient } from "square";
import { createScriptClient } from "../lib/client";
import { idempotencyKey, randomSample } from "../lib/random";
import { info, logSquareError, step, success, warn } from "../lib/log";

const DEFAULT_REFUND_COUNT = 5;

async function main() {
  const count = readCountArg();
  const client = createScriptClient();

  step("Finding completed, customer-attached payments with no existing refund");
  const candidates = await findRefundableCustomerPayments(client);
  info(`Found ${candidates.length} eligible payment(s).`);

  if (candidates.length === 0) {
    warn(
      "Nothing to refund. Run `npm run seed:customers` then `npm run seed:orders` / " +
        "`npm run seed:payments` first so there are customer-attached payments to refund.",
    );
    return;
  }

  const picks = randomSample(candidates, count);
  if (picks.length < count) {
    warn(`Only ${picks.length} eligible payment(s) available — refunding all of them (wanted ${count}).`);
  }

  step(`Issuing ${picks.length} full refund(s)`);
  let refunded = 0;
  for (const payment of picks) {
    try {
      await issueFullRefund(client, payment);
      refunded += 1;
      info(`Refunded ${formatMoney(payment.amountMoney)} — payment ${payment.id} (customer ${payment.customerId}).`);
    } catch (error) {
      logSquareError(`Failed to refund payment ${payment.id}`, error);
    }
  }

  success(`Issued ${refunded}/${picks.length} full refund(s).`);
}

function readCountArg(): number {
  const arg = process.argv.find((a) => a.startsWith("--count="));
  const value = arg ? Number(arg.split("=")[1]) : DEFAULT_REFUND_COUNT;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_REFUND_COUNT;
}

async function findRefundableCustomerPayments(client: SquareClient): Promise<Payment[]> {
  const candidates: Payment[] = [];
  const page = await client.payments.list({ sortField: "CREATED_AT" });

  for await (const payment of page) {
    if (payment.status !== "COMPLETED") continue;
    if (!payment.id || !payment.customerId) continue;
    if (!payment.amountMoney || Number(payment.amountMoney.amount ?? 0) <= 0) continue;
    if (Number(payment.refundedMoney?.amount ?? 0) > 0) continue; // already (partially) refunded
    candidates.push(payment);
  }

  return candidates;
}

async function issueFullRefund(client: SquareClient, payment: Payment) {
  if (!payment.id || !payment.amountMoney) {
    throw new Error("Payment is missing an id or amount.");
  }

  await client.refunds.refundPayment({
    idempotencyKey: idempotencyKey(),
    paymentId: payment.id,
    amountMoney: payment.amountMoney,
    reason: "Full refund seeded for testing",
  });
}

function formatMoney(money?: { amount?: bigint | number | null; currency?: string | null }): string {
  const cents = Number(money?.amount ?? 0);
  return `$${(cents / 100).toFixed(2)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logSquareError("Refund seed failed", error);
    process.exit(1);
  });
}

export { main };
