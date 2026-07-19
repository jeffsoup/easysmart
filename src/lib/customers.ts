import type { Order, Payment, SquareClient } from "square";

const LOOKBACK_DAYS = 30;

export type CustomerMetricsReport = {
  lookbackDays: number;
  /** Profiles in the Square Customers directory. */
  totalCustomers: number;
  /** Distinct customers with ≥1 completed payment in the lookback. */
  payingCustomerCount: number;
  /** Sum of completed payment amounts attributed to a customer. */
  attributedPaymentTotal: number;
  /** attributedPaymentTotal ÷ payingCustomerCount (null if none). */
  avgPaymentPerCustomer: number | null;
  /** Completed orders with a customerId in the lookback. */
  visitCount: number;
  /** Distinct customers with ≥1 completed order in the lookback. */
  visitingCustomerCount: number;
  /** visitCount ÷ visitingCustomerCount (null if none). */
  avgVisitsPerCustomer: number | null;
  unattributedOrderCount: number;
  cards: string[];
};

export async function fetchCustomerMetrics(
  client: SquareClient,
): Promise<CustomerMetricsReport> {
  const locations = await client.locations.list();
  const locationIds = (locations.locations ?? [])
    .map((location) => location.id)
    .filter((id): id is string => Boolean(id));

  const totalCustomers = await countCustomers(client);

  if (locationIds.length === 0) {
    return emptyReport(totalCustomers);
  }

  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - (LOOKBACK_DAYS - 1));
  start.setUTCHours(0, 0, 0, 0);

  const [paymentStats, orderStats] = await Promise.all([
    loadPaymentStats(client, locationIds, start, end),
    loadOrderVisitStats(client, locationIds, start, end),
  ]);

  const avgPaymentPerCustomer =
    paymentStats.payingCustomerCount > 0
      ? round2(
          paymentStats.attributedPaymentTotal /
            paymentStats.payingCustomerCount,
        )
      : null;

  const avgVisitsPerCustomer =
    orderStats.visitingCustomerCount > 0
      ? round1(orderStats.visitCount / orderStats.visitingCustomerCount)
      : null;

  const cards: string[] = [];
  if (totalCustomers === 0) {
    cards.push(
      "No customer profiles yet. Seed customers (or create them in Square), then attach them to orders/payments.",
    );
  } else if (paymentStats.payingCustomerCount === 0) {
    cards.push(
      "Customer profiles exist, but no completed payments in the last 30 days have a customer attached.",
    );
  } else {
    cards.push(
      `${paymentStats.payingCustomerCount} of ${totalCustomers} customers paid in the last ${LOOKBACK_DAYS} days.`,
    );
  }

  if (orderStats.unattributedOrderCount > 0) {
    cards.push(
      `${orderStats.unattributedOrderCount} completed orders had no customer (excluded from visit averages).`,
    );
  }

  return {
    lookbackDays: LOOKBACK_DAYS,
    totalCustomers,
    payingCustomerCount: paymentStats.payingCustomerCount,
    attributedPaymentTotal: paymentStats.attributedPaymentTotal,
    avgPaymentPerCustomer,
    visitCount: orderStats.visitCount,
    visitingCustomerCount: orderStats.visitingCustomerCount,
    avgVisitsPerCustomer,
    unattributedOrderCount: orderStats.unattributedOrderCount,
    cards,
  };
}

function emptyReport(totalCustomers: number): CustomerMetricsReport {
  return {
    lookbackDays: LOOKBACK_DAYS,
    totalCustomers,
    payingCustomerCount: 0,
    attributedPaymentTotal: 0,
    avgPaymentPerCustomer: null,
    visitCount: 0,
    visitingCustomerCount: 0,
    avgVisitsPerCustomer: null,
    unattributedOrderCount: 0,
    cards:
      totalCustomers === 0
        ? ["No locations or customers found for this merchant."]
        : [],
  };
}

async function countCustomers(client: SquareClient): Promise<number> {
  let count = 0;
  const page = await client.customers.list({});
  for await (const customer of page) {
    if (customer.id) count += 1;
  }
  return count;
}

async function loadPaymentStats(
  client: SquareClient,
  locationIds: string[],
  start: Date,
  end: Date,
): Promise<{
  attributedPaymentTotal: number;
  payingCustomerCount: number;
}> {
  const spendByCustomer = new Map<string, number>();

  for (const locationId of locationIds) {
    const page = await client.payments.list({
      locationId,
      beginTime: start.toISOString(),
      endTime: end.toISOString(),
      sortOrder: "DESC",
      limit: 100,
    });

    for await (const payment of page) {
      if (!isCompletedPayment(payment)) continue;
      const customerId = payment.customerId;
      if (!customerId) continue;
      const amount = paymentAmountDollars(payment);
      if (amount <= 0) continue;
      spendByCustomer.set(
        customerId,
        (spendByCustomer.get(customerId) ?? 0) + amount,
      );
    }
  }

  let attributedPaymentTotal = 0;
  for (const amount of spendByCustomer.values()) {
    attributedPaymentTotal += amount;
  }

  return {
    attributedPaymentTotal: round2(attributedPaymentTotal),
    payingCustomerCount: spendByCustomer.size,
  };
}

async function loadOrderVisitStats(
  client: SquareClient,
  locationIds: string[],
  start: Date,
  end: Date,
): Promise<{
  visitCount: number;
  visitingCustomerCount: number;
  unattributedOrderCount: number;
}> {
  const visitsByCustomer = new Map<string, number>();
  let unattributedOrderCount = 0;
  let cursor: string | undefined;

  do {
    const page = await client.orders.search({
      locationIds,
      cursor,
      query: {
        filter: {
          stateFilter: { states: ["COMPLETED"] },
          dateTimeFilter: {
            closedAt: {
              startAt: start.toISOString(),
              endAt: end.toISOString(),
            },
          },
        },
        sort: {
          sortField: "CLOSED_AT",
          sortOrder: "DESC",
        },
      },
      limit: 100,
    });

    for (const order of page.orders ?? []) {
      const customerId = orderCustomerId(order);
      if (!customerId) {
        unattributedOrderCount += 1;
        continue;
      }
      visitsByCustomer.set(
        customerId,
        (visitsByCustomer.get(customerId) ?? 0) + 1,
      );
    }

    cursor = page.cursor;
  } while (cursor);

  let visitCount = 0;
  for (const count of visitsByCustomer.values()) {
    visitCount += count;
  }

  return {
    visitCount,
    visitingCustomerCount: visitsByCustomer.size,
    unattributedOrderCount,
  };
}

function orderCustomerId(order: Order): string | null {
  return order.customerId?.trim() || null;
}

function isCompletedPayment(payment: Payment): boolean {
  const status = payment.status?.toUpperCase();
  return status === "COMPLETED" || status === "APPROVED";
}

function paymentAmountDollars(payment: Payment): number {
  const amount = Number(payment.amountMoney?.amount ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return amount / 100;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
