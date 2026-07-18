import type { CatalogObject, Order, SquareClient } from "square";

const DEFAULT_LOW_STOCK = 5;
const SLOW_MOVER_MIN_QTY = 5;
const REORDER_DAYS_OF_COVER = 7;
/** Assumed supplier lead time for reorder math (days). */
export const LEAD_TIME_DAYS = 7;
/** Target on-hand cover after a reorder = lead time + buffer. */
export const TARGET_COVER_DAYS = LEAD_TIME_DAYS + 7;
const LOOKBACK_DAYS = 30;

export type InventoryStatus =
  | "out_of_stock"
  | "low_stock"
  | "slow_mover"
  | "healthy";

export type InventoryItemHealth = {
  variationId: string;
  name: string;
  sku: string | null;
  quantity: number;
  unitsSold30d: number;
  avgDaily: number;
  daysOfCover: number | null;
  suggestedReorderQty: number;
  status: InventoryStatus;
  insight: string;
};

export type InventoryHealthReport = {
  items: InventoryItemHealth[];
  trackedCount: number;
  outOfStock: InventoryItemHealth[];
  lowStock: InventoryItemHealth[];
  slowMovers: InventoryItemHealth[];
  reorderSuggestions: InventoryItemHealth[];
  cards: string[];
};

type TrackedVariation = {
  variationId: string;
  name: string;
  sku: string | null;
  alertThreshold: number;
};

export async function fetchInventoryHealth(
  client: SquareClient,
): Promise<InventoryHealthReport> {
  const [variations, locationIds] = await Promise.all([
    listTrackedVariations(client),
    listLocationIds(client),
  ]);

  if (variations.length === 0 || locationIds.length === 0) {
    return emptyReport();
  }

  const [quantityByVariation, unitsSoldByVariation] = await Promise.all([
    fetchInStockQuantities(client, locationIds),
    fetchUnitsSoldByVariation(client, locationIds),
  ]);

  const items = variations.map((variation) =>
    scoreVariation(
      variation,
      quantityByVariation.get(variation.variationId) ?? 0,
      unitsSoldByVariation.get(variation.variationId) ?? 0,
    ),
  );

  const outOfStock = items
    .filter((item) => item.status === "out_of_stock")
    .sort((a, b) => b.unitsSold30d - a.unitsSold30d);
  const lowStock = items
    .filter((item) => item.status === "low_stock")
    .sort((a, b) => {
      const aCover = a.daysOfCover ?? Number.POSITIVE_INFINITY;
      const bCover = b.daysOfCover ?? Number.POSITIVE_INFINITY;
      return aCover - bCover || a.quantity - b.quantity;
    });
  const slowMovers = items
    .filter((item) => item.status === "slow_mover")
    .sort((a, b) => b.quantity - a.quantity);
  const reorderSuggestions = items
    .filter((item) => item.suggestedReorderQty > 0)
    .sort((a, b) => {
      const aCover = a.daysOfCover ?? -1;
      const bCover = b.daysOfCover ?? -1;
      return aCover - bCover || b.suggestedReorderQty - a.suggestedReorderQty;
    });

  return {
    items,
    trackedCount: items.length,
    outOfStock,
    lowStock,
    slowMovers,
    reorderSuggestions,
    cards: buildInsightCards({
      outOfStock,
      lowStock,
      slowMovers,
      reorderSuggestions,
      items,
    }),
  };
}

function emptyReport(): InventoryHealthReport {
  return {
    items: [],
    trackedCount: 0,
    outOfStock: [],
    lowStock: [],
    slowMovers: [],
    reorderSuggestions: [],
    cards: [
      "No tracked inventory items yet. Enable inventory tracking on catalog variations in the Square Dashboard, set stock counts, then reconnect if needed.",
    ],
  };
}

async function listLocationIds(client: SquareClient): Promise<string[]> {
  const response = await client.locations.list();
  return (response.locations ?? [])
    .map((location) => location.id)
    .filter((id): id is string => Boolean(id));
}

async function listTrackedVariations(
  client: SquareClient,
): Promise<TrackedVariation[]> {
  const variations: TrackedVariation[] = [];
  const page = await client.catalog.list({ types: "ITEM" });

  for await (const object of page) {
    if (object.type !== "ITEM") continue;
    const itemName = object.itemData?.name?.trim() || "Untitled item";
    const nested = object.itemData?.variations ?? [];

    for (const variationObject of nested) {
      const tracked = toTrackedVariation(variationObject, itemName);
      if (tracked) variations.push(tracked);
    }
  }

  return variations;
}

function toTrackedVariation(
  object: CatalogObject,
  itemName: string,
): TrackedVariation | null {
  if (object.type !== "ITEM_VARIATION") return null;
  const data = object.itemVariationData;
  if (!data?.trackInventory) return null;

  const variationName = data.name?.trim();
  const name =
    !variationName || variationName.toLowerCase() === "regular"
      ? itemName
      : `${itemName} · ${variationName}`;

  const threshold = data.inventoryAlertThreshold;
  const alertThreshold =
    threshold != null && Number(threshold) > 0
      ? Number(threshold)
      : DEFAULT_LOW_STOCK;

  return {
    variationId: object.id,
    name,
    sku: data.sku?.trim() || null,
    alertThreshold,
  };
}

async function fetchInStockQuantities(
  client: SquareClient,
  locationIds: string[],
): Promise<Map<string, number>> {
  const quantities = new Map<string, number>();
  const page = await client.inventory.batchGetCounts({
    locationIds,
    states: ["IN_STOCK"],
  });

  for await (const count of page) {
    const variationId = count.catalogObjectId;
    if (!variationId) continue;
    const qty = Number(count.quantity ?? 0);
    if (!Number.isFinite(qty)) continue;
    quantities.set(variationId, (quantities.get(variationId) ?? 0) + qty);
  }

  return quantities;
}

async function fetchUnitsSoldByVariation(
  client: SquareClient,
  locationIds: string[],
): Promise<Map<string, number>> {
  const sold = new Map<string, number>();
  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - (LOOKBACK_DAYS - 1));
  start.setUTCHours(0, 0, 0, 0);

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
          sortOrder: "ASC",
        },
      },
      limit: 100,
    });

    for (const order of page.orders ?? []) {
      accumulateLineItemSales(order, sold);
    }
    cursor = page.cursor;
  } while (cursor);

  return sold;
}

function accumulateLineItemSales(order: Order, sold: Map<string, number>) {
  for (const line of order.lineItems ?? []) {
    const variationId = line.catalogObjectId;
    if (!variationId) continue;
    const qty = Number(line.quantity ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    sold.set(variationId, (sold.get(variationId) ?? 0) + qty);
  }
}

function suggestedReorderQuantity(quantity: number, avgDaily: number): number {
  if (avgDaily <= 0) return 0;
  const targetOnHand = Math.ceil(avgDaily * TARGET_COVER_DAYS);
  return Math.max(0, targetOnHand - Math.max(0, quantity));
}

function scoreVariation(
  variation: TrackedVariation,
  quantity: number,
  unitsSold30d: number,
): InventoryItemHealth {
  const avgDaily = Number((unitsSold30d / LOOKBACK_DAYS).toFixed(2));
  const daysOfCover =
    avgDaily > 0 ? Number((quantity / avgDaily).toFixed(1)) : null;
  const suggestedReorderQty = suggestedReorderQuantity(quantity, avgDaily);

  if (quantity <= 0) {
    return {
      variationId: variation.variationId,
      name: variation.name,
      sku: variation.sku,
      quantity,
      unitsSold30d,
      avgDaily,
      daysOfCover: 0,
      suggestedReorderQty,
      status: "out_of_stock",
      insight:
        suggestedReorderQty > 0
          ? `Out of stock — reorder ~${formatUnits(suggestedReorderQty)} to cover ~${TARGET_COVER_DAYS} days (incl. ${LEAD_TIME_DAYS}-day lead time).`
          : unitsSold30d > 0
            ? `Out of stock — sold ${formatUnits(unitsSold30d)} in the last ${LOOKBACK_DAYS} days.`
            : "Out of stock with no recent sales.",
    };
  }

  if (
    daysOfCover != null &&
    daysOfCover < REORDER_DAYS_OF_COVER &&
    unitsSold30d > 0
  ) {
    return {
      variationId: variation.variationId,
      name: variation.name,
      sku: variation.sku,
      quantity,
      unitsSold30d,
      avgDaily,
      daysOfCover,
      suggestedReorderQty,
      status: "low_stock",
      insight:
        suggestedReorderQty > 0
          ? `~${daysOfCover} days of cover — reorder ~${formatUnits(suggestedReorderQty)} to reach ~${TARGET_COVER_DAYS} days.`
          : `About ${daysOfCover} days of cover left at the current sell-through rate — reorder soon.`,
    };
  }

  if (quantity <= variation.alertThreshold) {
    return {
      variationId: variation.variationId,
      name: variation.name,
      sku: variation.sku,
      quantity,
      unitsSold30d,
      avgDaily,
      daysOfCover,
      suggestedReorderQty,
      status: "low_stock",
      insight:
        suggestedReorderQty > 0
          ? `Only ${formatUnits(quantity)} left — reorder ~${formatUnits(suggestedReorderQty)}.`
          : `Only ${formatUnits(quantity)} left (threshold ${variation.alertThreshold}).`,
    };
  }

  if (unitsSold30d === 0 && quantity >= SLOW_MOVER_MIN_QTY) {
    return {
      variationId: variation.variationId,
      name: variation.name,
      sku: variation.sku,
      quantity,
      unitsSold30d,
      avgDaily,
      daysOfCover,
      suggestedReorderQty: 0,
      status: "slow_mover",
      insight: `${formatUnits(quantity)} on hand with no sales in ${LOOKBACK_DAYS} days — cash tied up in stock.`,
    };
  }

  return {
    variationId: variation.variationId,
    name: variation.name,
    sku: variation.sku,
    quantity,
    unitsSold30d,
    avgDaily,
    daysOfCover,
    suggestedReorderQty,
    status: "healthy",
    insight:
      daysOfCover != null
        ? `Healthy — roughly ${daysOfCover} days of cover.`
        : `In stock (${formatUnits(quantity)}).`,
  };
}

function buildInsightCards(input: {
  outOfStock: InventoryItemHealth[];
  lowStock: InventoryItemHealth[];
  slowMovers: InventoryItemHealth[];
  reorderSuggestions: InventoryItemHealth[];
  items: InventoryItemHealth[];
}): string[] {
  const cards: string[] = [];

  if (input.reorderSuggestions.length > 0) {
    const top = input.reorderSuggestions[0];
    const units = input.reorderSuggestions.reduce(
      (sum, item) => sum + item.suggestedReorderQty,
      0,
    );
    cards.push(
      `Reorder ${input.reorderSuggestions.length} item${input.reorderSuggestions.length === 1 ? "" : "s"} (~${formatUnits(units)} units total). Top pick: ${top.name} — order ~${formatUnits(top.suggestedReorderQty)}.`,
    );
  }

  if (input.outOfStock.length > 0) {
    const names = input.outOfStock
      .slice(0, 3)
      .map((item) => item.name)
      .join("; ");
    cards.push(
      `${input.outOfStock.length} item${input.outOfStock.length === 1 ? "" : "s"} out of stock${names ? `: ${names}` : ""}.`,
    );
  }

  if (input.lowStock.length > 0) {
    const top = input.lowStock[0];
    cards.push(
      `${input.lowStock.length} item${input.lowStock.length === 1 ? "" : "s"} need attention soon. Highest priority: ${top.name} (${formatUnits(top.quantity)} left${top.daysOfCover != null ? `, ~${top.daysOfCover} days cover` : ""}).`,
    );
  }

  if (input.slowMovers.length > 0) {
    const top = input.slowMovers[0];
    cards.push(
      `${input.slowMovers.length} slow mover${input.slowMovers.length === 1 ? "" : "s"} — e.g. ${top.name} has ${formatUnits(top.quantity)} on hand with no sales in ${LOOKBACK_DAYS} days.`,
    );
  }

  if (cards.length === 0 && input.items.length > 0) {
    cards.push(
      `Inventory looks healthy across ${input.items.length} tracked variation${input.items.length === 1 ? "" : "s"}.`,
    );
  }

  return cards;
}

function formatUnits(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
