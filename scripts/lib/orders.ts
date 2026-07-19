import type { Order, SquareClient } from "square";
import { idempotencyKey } from "./random";
import { warn } from "./log";

/** Square's standard Sandbox test nonce for a successful card charge. */
const SANDBOX_CARD_NONCE = "cnon:card-nonce-ok";

/**
 * Pays an order in full, completing it. Uses the Sandbox card-nonce tender
 * (not CASH) because associating a payment with a team member — via
 * `teamMemberId` — is how Square attributes sales to staff, and that
 * attribution is what "sold by" / team-performance reporting keys off of.
 *
 * If the order itself has a `customerId` (seed-orders.ts attaches one to
 * most orders), that same customer is carried onto the payment too, so the
 * order and its payment stay linked to the same buyer.
 */
export async function payOrderInFull(client: SquareClient, order: Order, teamMemberId?: string) {
  const amountMoney = order.totalMoney;
  if (!amountMoney || !order.id || !order.locationId) {
    warn(`Order ${order.id ?? "unknown"} has no total — leaving it open.`);
    return null;
  }

  const response = await client.payments.create({
    idempotencyKey: idempotencyKey(),
    sourceId: SANDBOX_CARD_NONCE,
    orderId: order.id,
    locationId: order.locationId,
    amountMoney,
    teamMemberId,
    customerId: order.customerId ?? undefined,
    autocomplete: true,
  });

  return response.payment ?? null;
}

/** All OPEN orders at the given locations (paginated). */
export async function findOpenOrders(client: SquareClient, locationIds: string[]): Promise<Order[]> {
  const orders: Order[] = [];
  let cursor: string | undefined;

  do {
    const page = await client.orders.search({
      locationIds,
      cursor,
      query: { filter: { stateFilter: { states: ["OPEN"] } } },
      limit: 100,
    });
    orders.push(...(page.orders ?? []));
    cursor = page.cursor;
  } while (cursor);

  return orders;
}
