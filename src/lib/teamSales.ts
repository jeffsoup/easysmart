import type { Order, OrderLineItem, Payment, SquareClient } from "square";

const LOOKBACK_DAYS = 30;
const ORDER_BATCH_SIZE = 100;

export type TeamMemberItemSale = {
  catalogObjectId: string | null;
  name: string;
  quantity: number;
  netSales: number;
};

export type TeamMemberSalesRow = {
  teamMemberId: string;
  teamMemberName: string;
  orderCount: number;
  netSales: number;
  itemCount: number;
  items: TeamMemberItemSale[];
};

export type TeamSalesReport = {
  lookbackDays: number;
  attributedSales: number;
  unattributedPaymentCount: number;
  attributedOrderCount: number;
  byTeamMember: TeamMemberSalesRow[];
};

/**
 * Attribute completed order line items to team members via Payments.team_member_id.
 * This is who ran the payment on POS — not a perfect “ticket owner” signal.
 */
export async function fetchSalesByTeamMember(
  client: SquareClient,
  nameById: Map<string, string>,
): Promise<TeamSalesReport> {
  const locations = await client.locations.list();
  const locationIds = (locations.locations ?? [])
    .map((location) => location.id)
    .filter((id): id is string => Boolean(id));

  if (locationIds.length === 0) {
    return emptyTeamSales();
  }

  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - (LOOKBACK_DAYS - 1));
  start.setUTCHours(0, 0, 0, 0);

  const orderToMember = new Map<string, string>();
  let unattributedPaymentCount = 0;

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
      const orderId = payment.orderId;
      if (!orderId) continue;

      const teamMemberId = payment.teamMemberId ?? payment.employeeId ?? null;
      if (!teamMemberId) {
        unattributedPaymentCount += 1;
        continue;
      }

      // First attribution wins if multiple payments hit the same order.
      if (!orderToMember.has(orderId)) {
        orderToMember.set(orderId, teamMemberId);
      }
    }
  }

  const orderIds = [...orderToMember.keys()];
  const orders = await batchLoadOrders(client, orderIds);

  const byMember = new Map<
    string,
    {
      teamMemberId: string;
      teamMemberName: string;
      orderIds: Set<string>;
      netSalesCents: number;
      items: Map<string, { catalogObjectId: string | null; name: string; quantity: number; netSalesCents: number }>;
    }
  >();

  for (const order of orders) {
    if (!order.id) continue;
    const teamMemberId = orderToMember.get(order.id);
    if (!teamMemberId) continue;

    const bucket =
      byMember.get(teamMemberId) ??
      {
        teamMemberId,
        teamMemberName: nameById.get(teamMemberId) ?? "Unknown team member",
        orderIds: new Set<string>(),
        netSalesCents: 0,
        items: new Map(),
      };

    bucket.orderIds.add(order.id);

    for (const line of order.lineItems ?? []) {
      const qty = Number(line.quantity ?? 0);
      const netCents = lineNetSalesCents(line);
      if (!Number.isFinite(qty) || qty <= 0 || netCents <= 0) continue;

      bucket.netSalesCents += netCents;
      const key = line.catalogObjectId ?? line.name ?? line.uid ?? "custom";
      const name = lineItemName(line);
      const existing = bucket.items.get(key) ?? {
        catalogObjectId: line.catalogObjectId ?? null,
        name,
        quantity: 0,
        netSalesCents: 0,
      };
      existing.quantity += qty;
      existing.netSalesCents += netCents;
      bucket.items.set(key, existing);
    }

    byMember.set(teamMemberId, bucket);
  }

  const byTeamMember: TeamMemberSalesRow[] = [...byMember.values()]
    .map((row) => ({
      teamMemberId: row.teamMemberId,
      teamMemberName: row.teamMemberName,
      orderCount: row.orderIds.size,
      netSales: round2(row.netSalesCents / 100),
      itemCount: [...row.items.values()].reduce((sum, item) => sum + item.quantity, 0),
      items: [...row.items.values()]
        .map((item) => ({
          catalogObjectId: item.catalogObjectId,
          name: item.name,
          quantity: round1(item.quantity),
          netSales: round2(item.netSalesCents / 100),
        }))
        .sort((a, b) => b.netSales - a.netSales),
    }))
    .sort((a, b) => b.netSales - a.netSales);

  return {
    lookbackDays: LOOKBACK_DAYS,
    attributedSales: round2(
      byTeamMember.reduce((sum, row) => sum + row.netSales, 0),
    ),
    unattributedPaymentCount,
    attributedOrderCount: orderIds.length,
    byTeamMember,
  };
}

function emptyTeamSales(): TeamSalesReport {
  return {
    lookbackDays: LOOKBACK_DAYS,
    attributedSales: 0,
    unattributedPaymentCount: 0,
    attributedOrderCount: 0,
    byTeamMember: [],
  };
}

function isCompletedPayment(payment: Payment): boolean {
  const status = payment.status?.toUpperCase();
  return status === "COMPLETED" || status === "APPROVED";
}

async function batchLoadOrders(
  client: SquareClient,
  orderIds: string[],
): Promise<Order[]> {
  if (orderIds.length === 0) return [];

  const orders: Order[] = [];
  for (let i = 0; i < orderIds.length; i += ORDER_BATCH_SIZE) {
    const chunk = orderIds.slice(i, i + ORDER_BATCH_SIZE);
    const response = await client.orders.batchGet({ orderIds: chunk });
    orders.push(...(response.orders ?? []));
  }
  return orders;
}

function lineNetSalesCents(line: OrderLineItem): number {
  const total = Number(line.totalMoney?.amount ?? 0);
  const tax = Number(line.totalTaxMoney?.amount ?? 0);
  // Prefer gross sales when present (closer to product sales before tip).
  const gross = Number(line.grossSalesMoney?.amount ?? 0);
  if (gross > 0) {
    const discount = Number(line.totalDiscountMoney?.amount ?? 0);
    return Math.max(0, gross - discount);
  }
  return Math.max(0, total - tax);
}

function lineItemName(line: OrderLineItem): string {
  const base = line.name?.trim() || "Custom amount";
  const variation = line.variationName?.trim();
  if (!variation || variation.toLowerCase() === "regular") return base;
  return `${base} · ${variation}`;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
