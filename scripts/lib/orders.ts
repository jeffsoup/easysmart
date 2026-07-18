import type { Order, SquareClient } from "square";
import { idempotencyKey } from "./random";
import { warn } from "./log";

/** Pays an order in full with a CASH tender, completing it. */
export async function payOrderInFull(client: SquareClient, order: Order) {
  const amountMoney = order.totalMoney;
  if (!amountMoney || !order.id || !order.locationId) {
    warn(`Order ${order.id ?? "unknown"} has no total — leaving it open.`);
    return null;
  }

  const response = await client.payments.create({
    idempotencyKey: idempotencyKey(),
    sourceId: "CASH",
    orderId: order.id,
    locationId: order.locationId,
    amountMoney,
    cashDetails: { buyerSuppliedMoney: amountMoney },
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
