import type { Order, OrderLineItem, Payment, SquareClient } from "square";
import type { ResolvedSalesRange } from "./salesRange";
import { zonedRangeBounds } from "./salesRange";

const CATALOG_BATCH_SIZE = 100;

export type DayItemSaleRow = {
  id: string;
  sku: string | null;
  itemName: string;
  soldAmount: number;
  soldAt: string;
  soldAtLabel: string;
  workDate: string;
  teamMemberName: string;
  quantity: number;
};

export type DayItemSalesReport = {
  byDay: Record<string, DayItemSaleRow[]>;
  timeZone: string;
  range: ResolvedSalesRange;
};

/**
 * Line-item sales for each local calendar day in range, with payment
 * team-member attribution and catalog SKUs when available.
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

  const [orders, orderToMember, nameById] = await Promise.all([
    searchCompletedOrders(client, locationIds, start, end),
    loadOrderTeamMembers(client, locationIds, start, end),
    loadTeamMemberNames(client, locationIds),
  ]);

  const catalogIds = new Set<string>();
  for (const order of orders) {
    for (const line of order.lineItems ?? []) {
      if (line.catalogObjectId) catalogIds.add(line.catalogObjectId);
    }
  }
  const skuByCatalogId = await loadSkus(client, [...catalogIds]);

  const byDay: Record<string, DayItemSaleRow[]> = {};

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
      if (!Number.isFinite(qty) || qty <= 0 || amountCents <= 0) continue;

      const row: DayItemSaleRow = {
        id: `${order.id}-${line.uid ?? lineIndex}`,
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
      };

      const dayRows = byDay[workDate] ?? [];
      dayRows.push(row);
      byDay[workDate] = dayRows;
      lineIndex += 1;
    }
  }

  for (const date of Object.keys(byDay)) {
    byDay[date].sort((a, b) => b.soldAt.localeCompare(a.soldAt));
  }

  return { byDay, timeZone, range: { ...range, timeZone } };
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
