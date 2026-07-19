/**
 * Seeds a batch of realistic Orders against the catalog created by
 * seed-inventory.ts. Most orders are immediately paid (CASH) and completed,
 * so the Sales chart and Inventory Health "units sold" numbers have data.
 * A few are left OPEN to simulate in-progress tickets.
 *
 * Item selection is deliberate, not uniform: seed-inventory.ts tags each
 * variation with a sales profile (catalog-seed-data.ts). Variations with a
 * `forcedQuantity` (the "strong seller" and "near-zero cover" items) are
 * added to every single order so their sell-through is guaranteed rather
 * than left to chance; everything else fills remaining line items by
 * weight, and "dead stock" / "out of stock" items (orderWeight 0) are never
 * picked at all. See catalog-seed-data.ts for the full mix and the math
 * behind it.
 *
 * Caveat: Square sets Order created_at/closed_at server-side — there's no
 * way to backdate orders. Everything created here lands on "today". Run
 * this script again on a later day (or via cron) to build up multi-day
 * history for the 30-day sales chart. See scripts/README.md.
 *
 * Usage: npm run seed:orders [-- --count=40]
 */
import type { SquareClient } from "square";
import { createScriptClient, listLocationIds } from "../lib/client";
import { allSeedVariations, type SeedVariation } from "../lib/catalog-seed-data";
import { payOrderInFull } from "../lib/orders";
import { listActiveTeamMemberIds } from "../lib/team";
import { listCustomerIds } from "../lib/customers";
import { idempotencyKey, randomChoice, randomInt, weightedSample } from "../lib/random";
import { info, logSquareError, step, success, warn } from "../lib/log";

const DEFAULT_ORDER_COUNT = 40;
const OPEN_ORDER_RATE = 0.15;
const MAX_EXTRA_LINE_ITEMS = 2;
/** Share of orders attached to a known customer — the rest are anonymous walk-ins. */
const CUSTOMER_ATTACH_RATE = 0.65;

type CatalogLineItem = {
  variationId: string;
  sku: string;
  orderWeight: number;
  forcedQuantity?: number;
};

async function main() {
  const count = readCountArg();
  const client = createScriptClient();
  const locationIds = await listLocationIds(client);

  step("Loading sellable catalog items");
  const catalogItems = await loadCatalogLineItems(client);
  if (catalogItems.length === 0) {
    throw new Error(
      "No sellable catalog items found. Run `npm run seed:inventory` first.",
    );
  }
  info(`Found ${catalogItems.length} catalog variations to order from.`);

  const forcedItems = catalogItems.filter((item) => item.forcedQuantity != null);
  const fillPool = catalogItems.filter((item) => item.orderWeight > 0);
  if (forcedItems.length === 0) {
    warn(
      "No 'strong seller' / 'near-zero cover' seed items found — run `npm run seed:inventory` " +
        "first for a deliberate inventory-health mix. Falling back to plain random selection.",
    );
  }

  const teamMemberIds = await listActiveTeamMemberIds(client);
  if (teamMemberIds.length === 0) {
    warn(
      "No active team members found — payments will be created without a team_member_id. " +
        "Run `npm run seed:team` first to attribute sales to staff.",
    );
  }

  const customerIds = await listCustomerIds(client);
  if (customerIds.length === 0) {
    warn(
      "No customers found — orders will be created without a customer_id. " +
        "Run `npm run seed:customers` first to attribute orders to buyers.",
    );
  }

  step(`Creating ${count} orders across ${locationIds.length} location(s)`);
  let completed = 0;
  let opened = 0;
  let failed = 0;

  for (let i = 0; i < count; i += 1) {
    const locationId = locationIds[randomInt(0, locationIds.length - 1)];
    const shouldComplete = Math.random() > OPEN_ORDER_RATE;

    try {
      const order = await createOrder(client, locationId, forcedItems, fillPool, catalogItems, customerIds);
      if (shouldComplete) {
        const teamMemberId = teamMemberIds.length > 0 ? randomChoice(teamMemberIds) : undefined;
        await payOrderInFull(client, order, teamMemberId);
        completed += 1;
      } else {
        opened += 1;
      }
    } catch (error) {
      failed += 1;
      logSquareError(`Order ${i + 1}/${count} failed`, error);
    }
  }

  success(
    `Created ${completed + opened} orders (${completed} paid/completed, ${opened} left open)${failed > 0 ? `, ${failed} failed` : ""}.`,
  );
}

function readCountArg(): number {
  const arg = process.argv.find((a) => a.startsWith("--count="));
  const value = arg ? Number(arg.split("=")[1]) : DEFAULT_ORDER_COUNT;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_ORDER_COUNT;
}

async function loadCatalogLineItems(client: SquareClient): Promise<CatalogLineItem[]> {
  const seedBySku = new Map<string, SeedVariation>(
    allSeedVariations().map((variation) => [variation.sku, variation]),
  );
  const items: CatalogLineItem[] = [];
  const page = await client.catalog.list({ types: "ITEM" });

  for await (const object of page) {
    if (object.type !== "ITEM") continue;

    for (const variation of object.itemData?.variations ?? []) {
      if (variation.type !== "ITEM_VARIATION" || !variation.id) continue;
      const data = variation.itemVariationData;
      if (!data?.sku || !Number(data.priceMoney?.amount ?? 0)) continue;

      const seed = seedBySku.get(data.sku);
      items.push({
        variationId: variation.id,
        sku: data.sku,
        // Catalog items outside our seed data (if any) default to a normal,
        // un-forced weight so they can still show up as "healthy" sellers.
        orderWeight: seed?.orderWeight ?? 1,
        forcedQuantity: seed?.forcedQuantity,
      });
    }
  }

  return items;
}

async function createOrder(
  client: SquareClient,
  locationId: string,
  forcedItems: CatalogLineItem[],
  fillPool: CatalogLineItem[],
  allItems: CatalogLineItem[],
  customerIds: string[],
) {
  const forcedIds = new Set(forcedItems.map((item) => item.variationId));
  const extrasPool = fillPool.filter((item) => !forcedIds.has(item.variationId));
  const extras = weightedSample(
    extrasPool,
    randomInt(0, MAX_EXTRA_LINE_ITEMS),
    (item) => item.orderWeight,
  );

  const picks = [
    ...forcedItems.map((item) => ({ variationId: item.variationId, quantity: item.forcedQuantity! })),
    ...extras.map((item) => ({ variationId: item.variationId, quantity: randomInt(1, 3) })),
  ];

  // Should only trigger if seed-inventory.ts was never run (empty forced/fill pools).
  if (picks.length === 0) {
    const fallback = randomChoice(allItems);
    picks.push({ variationId: fallback.variationId, quantity: 1 });
  }

  const customerId =
    customerIds.length > 0 && Math.random() < CUSTOMER_ATTACH_RATE
      ? randomChoice(customerIds)
      : undefined;

  const response = await client.orders.create({
    idempotencyKey: idempotencyKey(),
    order: {
      locationId,
      customerId,
      lineItems: picks.map((pick) => ({
        catalogObjectId: pick.variationId,
        quantity: String(pick.quantity),
      })),
    },
  });

  if (!response.order) {
    throw new Error("Order create returned no order.");
  }
  return response.order;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logSquareError("Order seed failed", error);
    process.exit(1);
  });
}

export { main };
