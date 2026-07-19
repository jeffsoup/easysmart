import type {
  Order,
  OrderLineItem,
  Payment,
  PaymentRefund,
  SquareClient,
} from "square";
import type { ResolvedSalesRange } from "./salesRange";
import { zonedRangeBounds } from "./salesRange";

const CATALOG_BATCH_SIZE = 100;
const ORDER_BATCH_SIZE = 100;

export type DayItemRefundDetail = {
  /** Positive dollars; UI renders as accounting-style negative. */
  amount: number;
  at: string;
  atLabel: string;
  teamMemberName: string;
  reason: string | null;
};

export type DayItemSaleRow = {
  id: string;
  orderId: string | null;
  lineKey: string;
  sku: string | null;
  itemName: string;
  /** Original sale amount for this line (0 when row is refund-only context). */
  soldAmount: number;
  soldAt: string;
  soldAtLabel: string;
  workDate: string;
  teamMemberName: string;
  quantity: number;
  /**
   * True when this row exists only so a refund can appear under the item
   * (the sale closed on a different day).
   */
  contextOnly: boolean;
  refund: DayItemRefundDetail | null;
};

export type DayItemSalesReport = {
  byDay: Record<string, DayItemSaleRow[]>;
  timeZone: string;
  range: ResolvedSalesRange;
};

/**
 * Line-item sales for each local calendar day in range, with payment
 * team-member attribution, catalog SKUs, and refunds nested under items.
 */
export async function fetchDayItemSales(
  client: SquareClient,
  range: ResolvedSalesRange,
): Promise<DayItemSalesReport> {
  const locations = await client.locations.list();
  const locationList = locations.locations ?? [];
  const locationIds = locationList
    .map((location) => location.id)
    .filter((id): id is string => Boolean(id));
  const timeZone =
    range.timeZone || locationList[0]?.timezone?.trim() || "UTC";

  if (locationIds.length === 0) {
    return { byDay: {}, timeZone, range: { ...range, timeZone } };
  }

  const { start, end } = zonedRangeBounds(
    range.startDate,
    range.endDate,
    timeZone,
  );

  const [orders, orderToMember, nameById, refunds] = await Promise.all([
    searchCompletedOrders(client, locationIds, start, end),
    loadOrderTeamMembers(client, locationIds, start, end),
    loadTeamMemberNames(client, locationIds),
    listRefunds(client, start, end),
  ]);

  const ordersById = new Map<string, Order>();
  for (const order of orders) {
    if (order.id) ordersById.set(order.id, order);
  }

  // PaymentRefund.orderId is often empty; resolve via Payments.get → orderId.
  const paymentIdsNeedingOrder = [
    ...new Set(
      refunds
        .filter((refund) => !refund.orderId && refund.paymentId)
        .map((refund) => refund.paymentId as string),
    ),
  ];
  const orderIdByPaymentId = await loadOrderIdsForPayments(
    client,
    paymentIdsNeedingOrder,
  );

  const refundOrderIds = [
    ...new Set(
      refunds
        .map(
          (refund) =>
            refund.orderId ??
            (refund.paymentId
              ? orderIdByPaymentId.get(refund.paymentId)
              : undefined),
        )
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const missingOrderIds = refundOrderIds.filter((id) => !ordersById.has(id));
  for (const order of await batchLoadOrders(client, missingOrderIds)) {
    if (order.id) ordersById.set(order.id, order);
  }

  const catalogIds = new Set<string>();
  for (const order of ordersById.values()) {
    for (const line of order.lineItems ?? []) {
      if (line.catalogObjectId) catalogIds.add(line.catalogObjectId);
    }
  }
  const skuByCatalogId = await loadSkus(client, [...catalogIds]);

  const byDay: Record<string, DayItemSaleRow[]> = {};
  /** workDate → lineKey → row index in that day's array */
  const indexByDayLine = new Map<string, Map<string, number>>();

  function pushRow(row: DayItemSaleRow) {
    const dayRows = byDay[row.workDate] ?? [];
    const dayIndex = indexByDayLine.get(row.workDate) ?? new Map();
    dayIndex.set(row.lineKey, dayRows.length);
    indexByDayLine.set(row.workDate, dayIndex);
    dayRows.push(row);
    byDay[row.workDate] = dayRows;
  }

  for (const order of orders) {
    if (!order.id) continue;
    const soldAt = order.closedAt ?? order.createdAt;
    if (!soldAt) continue;

    const workDate = dateInZone(soldAt, timeZone);
    if (workDate < range.startDate || workDate > range.endDate) continue;

    const soldAtLabel = dateTimeInZone(soldAt, timeZone);
    const teamMemberId = orderToMember.get(order.id) ?? null;
    const teamMemberName = teamMemberId
      ? (nameById.get(teamMemberId) ?? "Unknown team member")
      : "—";

    let lineIndex = 0;
    for (const line of order.lineItems ?? []) {
      const qty = Number(line.quantity ?? 0);
      const amountCents = lineNetSalesCents(line);
      if (!Number.isFinite(qty) || qty <= 0 || amountCents <= 0) {
        lineIndex += 1;
        continue;
      }

      pushRow({
        id: `${order.id}-${line.uid ?? lineIndex}`,
        orderId: order.id,
        lineKey: lineKey(order.id, line, lineIndex),
        sku: line.catalogObjectId
          ? (skuByCatalogId.get(line.catalogObjectId) ?? null)
          : null,
        itemName: lineItemName(line),
        soldAmount: round2(amountCents / 100),
        soldAt,
        soldAtLabel,
        workDate,
        teamMemberName,
        quantity: round1(qty),
        contextOnly: false,
        refund: null,
      });
      lineIndex += 1;
    }
  }

  for (const refund of refunds) {
    if (!isCountableRefund(refund)) continue;
    const refundAt = refund.createdAt;
    if (!refundAt) continue;

    const refundDate = dateInZone(refundAt, timeZone);
    if (refundDate < range.startDate || refundDate > range.endDate) continue;

    const refundDollars = Number(refund.amountMoney?.amount ?? 0) / 100;
    if (!Number.isFinite(refundDollars) || refundDollars <= 0) continue;

    const teamMemberId = refund.teamMemberId ?? null;
    const teamMemberName = teamMemberId
      ? (nameById.get(teamMemberId) ?? "Unknown team member")
      : "—";
    const reason = refund.reason?.trim() || null;
    const refundDetailBase = {
      at: refundAt,
      atLabel: dateTimeInZone(refundAt, timeZone),
      teamMemberName,
      reason,
    };

    const orderId =
      refund.orderId ??
      (refund.paymentId
        ? (orderIdByPaymentId.get(refund.paymentId) ?? null)
        : null);
    const order = orderId ? ordersById.get(orderId) : undefined;
    const allocations = allocateRefundToLines(order, refundDollars);

    if (allocations.length === 0) {
      // Payment had no order / line items (e.g. standalone custom-amount charge).
      pushRow({
        id: `refund-${refund.id}`,
        orderId,
        lineKey: `refund-${refund.id}`,
        sku: null,
        itemName: "Custom amount",
        soldAmount: round2(refundDollars),
        soldAt: refundAt,
        soldAtLabel: refundDetailBase.atLabel,
        workDate: refundDate,
        teamMemberName,
        quantity: 1,
        contextOnly: true,
        refund: { ...refundDetailBase, amount: round2(refundDollars) },
      });
      continue;
    }

    for (const allocation of allocations) {
      const key = lineKey(orderId!, allocation.line, allocation.index);
      const refundDetail: DayItemRefundDetail = {
        ...refundDetailBase,
        amount: allocation.amount,
      };

      const saleLocation = findSaleRow(byDay, indexByDayLine, key);
      if (saleLocation) {
        attachRefund(byDay, saleLocation.date, saleLocation.index, refundDetail);
      }

      const hasRefundDayRow =
        indexByDayLine.get(refundDate)?.has(key) ?? false;
      if (!hasRefundDayRow) {
        const line = allocation.line;
        const amountCents = lineNetSalesCents(line);
        const saleTeamId = orderId ? orderToMember.get(orderId) : null;
        pushRow({
          id: `refund-ctx-${refund.id}-${line.uid ?? allocation.index}`,
          orderId,
          lineKey: key,
          sku: line.catalogObjectId
            ? (skuByCatalogId.get(line.catalogObjectId) ?? null)
            : null,
          itemName: lineItemName(line),
          soldAmount: round2(amountCents / 100),
          soldAt: refundAt,
          soldAtLabel: refundDetailBase.atLabel,
          workDate: refundDate,
          teamMemberName: saleTeamId
            ? (nameById.get(saleTeamId) ?? teamMemberName)
            : teamMemberName,
          quantity: round1(Number(line.quantity ?? 1)),
          contextOnly: true,
          refund: refundDetail,
        });
      }
    }
  }

  for (const date of Object.keys(byDay)) {
    byDay[date].sort((a, b) => b.soldAt.localeCompare(a.soldAt));
  }

  return { byDay, timeZone, range: { ...range, timeZone } };
}

function lineKey(orderId: string, line: OrderLineItem, index: number): string {
  return `${orderId}:${line.uid ?? index}`;
}

function findSaleRow(
  byDay: Record<string, DayItemSaleRow[]>,
  indexByDayLine: Map<string, Map<string, number>>,
  key: string,
): { date: string; index: number } | null {
  for (const [date, dayMap] of indexByDayLine) {
    const index = dayMap.get(key);
    if (index == null) continue;
    const row = byDay[date]?.[index];
    if (row && !row.contextOnly) return { date, index };
  }
  return null;
}

function attachRefund(
  byDay: Record<string, DayItemSaleRow[]>,
  date: string,
  index: number,
  refundDetail: DayItemRefundDetail,
) {
  const existing = byDay[date]?.[index];
  if (!existing) return;
  byDay[date][index] = {
    ...existing,
    refund: existing.refund
      ? {
          ...existing.refund,
          amount: round2(existing.refund.amount + refundDetail.amount),
        }
      : refundDetail,
  };
}

/**
 * Split a payment refund across order line items in proportion to line net sales.
 * Full refunds map 1:1 to each line's amount when totals match.
 */
function allocateRefundToLines(
  order: Order | undefined,
  refundDollars: number,
): Array<{ line: OrderLineItem; amount: number; index: number }> {
  if (!order) return [];

  const lines: Array<{ line: OrderLineItem; cents: number; index: number }> =
    [];
  let index = 0;
  for (const line of order.lineItems ?? []) {
    const cents = lineNetSalesCents(line);
    const qty = Number(line.quantity ?? 0);
    if (Number.isFinite(qty) && qty > 0 && cents > 0) {
      lines.push({ line, cents, index });
    }
    index += 1;
  }

  if (lines.length === 0) return [];

  const orderCents = lines.reduce((sum, entry) => sum + entry.cents, 0);
  if (orderCents <= 0) return [];

  const refundCents = Math.round(refundDollars * 100);
  const allocations: Array<{
    line: OrderLineItem;
    amount: number;
    index: number;
  }> = [];
  let assigned = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const entry = lines[i];
    const share =
      i === lines.length - 1
        ? refundCents - assigned
        : Math.round((refundCents * entry.cents) / orderCents);
    assigned += share;
    if (share > 0) {
      allocations.push({
        line: entry.line,
        amount: round2(share / 100),
        index: entry.index,
      });
    }
  }

  return allocations;
}

async function loadOrderIdsForPayments(
  client: SquareClient,
  paymentIds: string[],
): Promise<Map<string, string>> {
  const orderIdByPaymentId = new Map<string, string>();
  // Payments API has no batch get; fetch concurrently in small chunks.
  const CHUNK = 8;
  for (let i = 0; i < paymentIds.length; i += CHUNK) {
    const chunk = paymentIds.slice(i, i + CHUNK);
    const results = await Promise.all(
      chunk.map(async (paymentId) => {
        try {
          const response = await client.payments.get({ paymentId });
          const orderId = response.payment?.orderId;
          return orderId ? ([paymentId, orderId] as const) : null;
        } catch {
          return null;
        }
      }),
    );
    for (const pair of results) {
      if (pair) orderIdByPaymentId.set(pair[0], pair[1]);
    }
  }
  return orderIdByPaymentId;
}

async function listRefunds(
  client: SquareClient,
  start: Date,
  end: Date,
): Promise<PaymentRefund[]> {
  const refunds: PaymentRefund[] = [];
  const page = await client.refunds.list({
    beginTime: start.toISOString(),
    endTime: end.toISOString(),
    sortOrder: "DESC",
    limit: 100,
  });

  for await (const refund of page) {
    refunds.push(refund);
  }

  return refunds;
}

function isCountableRefund(refund: PaymentRefund): boolean {
  const status = refund.status?.toUpperCase();
  return status === "COMPLETED" || status === "PENDING" || status === "APPROVED";
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

async function searchCompletedOrders(
  client: SquareClient,
  locationIds: string[],
  start: Date,
  end: Date,
): Promise<Order[]> {
  const orders: Order[] = [];
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
    orders.push(...(page.orders ?? []));
    cursor = page.cursor;
  } while (cursor);

  return orders;
}

async function loadOrderTeamMembers(
  client: SquareClient,
  locationIds: string[],
  start: Date,
  end: Date,
): Promise<Map<string, string>> {
  const orderToMember = new Map<string, string>();

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
      const teamMemberId = payment.teamMemberId ?? payment.employeeId ?? null;
      if (!orderId || !teamMemberId) continue;
      if (!orderToMember.has(orderId)) {
        orderToMember.set(orderId, teamMemberId);
      }
    }
  }

  return orderToMember;
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
        filter: { locationIds },
      },
    });

    for (const member of page.teamMembers ?? []) {
      if (!member.id) continue;
      const given = member.givenName?.trim() ?? "";
      const family = member.familyName?.trim() ?? "";
      names.set(
        member.id,
        [given, family].filter(Boolean).join(" ") || "Team member",
      );
    }
    cursor = page.cursor;
  } while (cursor);

  return names;
}

async function loadSkus(
  client: SquareClient,
  objectIds: string[],
): Promise<Map<string, string>> {
  const skus = new Map<string, string>();
  if (objectIds.length === 0) return skus;

  for (let i = 0; i < objectIds.length; i += CATALOG_BATCH_SIZE) {
    const chunk = objectIds.slice(i, i + CATALOG_BATCH_SIZE);
    const response = await client.catalog.batchGet({ objectIds: chunk });
    for (const object of response.objects ?? []) {
      if (object.type !== "ITEM_VARIATION") continue;
      const sku = object.itemVariationData?.sku?.trim();
      if (sku) skus.set(object.id, sku);
    }
  }

  return skus;
}

function isCompletedPayment(payment: Payment): boolean {
  const status = payment.status?.toUpperCase();
  return status === "COMPLETED" || status === "APPROVED";
}

function lineNetSalesCents(line: OrderLineItem): number {
  const total = Number(line.totalMoney?.amount ?? 0);
  const tax = Number(line.totalTaxMoney?.amount ?? 0);
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

function dateTimeInZone(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
