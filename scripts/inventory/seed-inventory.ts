/**
 * Seeds a small coffee-shop-style catalog (categories, items, variations)
 * and sets starting stock counts. The mix (see catalog-seed-data.ts) is
 * deliberately engineered — not random — to exercise every Inventory Health
 * rule: a strong seller, dead stock, near-zero cover, an out-of-stock item,
 * and healthy items.
 *
 * Usage: npm run seed:inventory
 */
import type { CatalogObject } from "square";
import { createScriptClient, listLocationIds } from "../lib/client";
import { SEED_ITEMS, type SeedItem } from "../lib/catalog-seed-data";
import { idempotencyKey } from "../lib/random";
import { info, logSquareError, step, success, warn } from "../lib/log";

async function main() {
  const client = createScriptClient();
  const [locationId] = await listLocationIds(client);

  step("Checking for existing seed categories/items");
  const existing = await loadExistingCatalog(client);

  const categoryNames = [...new Set(SEED_ITEMS.map((item) => item.category))];
  const missingCategories = categoryNames.filter((name) => !existing.categoryIdByName.has(name));
  const missingItems = SEED_ITEMS.filter((item) => {
    const skus = item.variations.map((v) => v.sku);
    return skus.some((sku) => !existing.variationIdBySku.has(sku));
  });

  if (missingCategories.length === 0 && missingItems.length === 0) {
    info("All seed categories and items already exist — skipping catalog creation.");
  } else {
    step(
      `Creating ${missingCategories.length} categor${missingCategories.length === 1 ? "y" : "ies"} and ${missingItems.length} item${missingItems.length === 1 ? "" : "s"}`,
    );
    await createCatalog(client, missingCategories, missingItems, existing.categoryIdByName);
  }

  step("Refreshing catalog to resolve variation IDs");
  const refreshed = await loadExistingCatalog(client);

  step(`Setting starting stock counts at location ${locationId}`);
  await setStockCounts(client, locationId, refreshed.variationIdBySku);

  success("Inventory seed complete. Run `npm run dev` and open the dashboard to see it.");
}

type ExistingCatalog = {
  categoryIdByName: Map<string, string>;
  variationIdBySku: Map<string, string>;
};

async function loadExistingCatalog(client: ReturnType<typeof createScriptClient>): Promise<ExistingCatalog> {
  const categoryIdByName = new Map<string, string>();
  const variationIdBySku = new Map<string, string>();

  const page = await client.catalog.list({ types: "CATEGORY,ITEM" });
  for await (const object of page) {
    if (object.type === "CATEGORY" && object.categoryData?.name && object.id) {
      categoryIdByName.set(object.categoryData.name, object.id);
    }
    if (object.type === "ITEM") {
      for (const variation of object.itemData?.variations ?? []) {
        if (variation.type !== "ITEM_VARIATION" || !variation.id) continue;
        const sku = variation.itemVariationData?.sku;
        if (sku) variationIdBySku.set(sku, variation.id);
      }
    }
  }

  return { categoryIdByName, variationIdBySku };
}

async function createCatalog(
  client: ReturnType<typeof createScriptClient>,
  missingCategories: string[],
  missingItems: SeedItem[],
  existingCategoryIds: Map<string, string>,
) {
  const objects: CatalogObject[] = [];
  const tempCategoryIdByName = new Map<string, string>();

  for (const name of missingCategories) {
    const tempId = `#cat-${slug(name)}`;
    tempCategoryIdByName.set(name, tempId);
    objects.push({
      type: "CATEGORY",
      id: tempId,
      categoryData: { name },
    });
  }

  const resolveCategoryId = (name: string) =>
    existingCategoryIds.get(name) ?? tempCategoryIdByName.get(name) ?? name;

  for (const item of missingItems) {
    objects.push({
      type: "ITEM",
      id: `#item-${slug(item.name)}`,
      itemData: {
        name: item.name,
        description: item.description,
        categoryId: resolveCategoryId(item.category),
        variations: item.variations.map((variation) => ({
          type: "ITEM_VARIATION",
          id: `#var-${slug(variation.sku)}`,
          itemVariationData: {
            name: variation.name,
            sku: variation.sku,
            pricingType: "FIXED_PRICING",
            priceMoney: { amount: BigInt(variation.priceCents), currency: "USD" },
            trackInventory: true,
            inventoryAlertType: "LOW_QUANTITY",
            inventoryAlertThreshold: BigInt(variation.alertThreshold),
          },
        })),
      },
      presentAtAllLocations: true,
    });
  }

  try {
    const response = await client.catalog.batchUpsert({
      idempotencyKey: idempotencyKey(),
      batches: [{ objects }],
    });
    for (const error of response.errors ?? []) {
      warn(`Catalog upsert warning: ${error.category} ${error.code} ${error.detail ?? ""}`);
    }
    success(`Upserted ${response.objects?.length ?? 0} catalog objects.`);
  } catch (error) {
    logSquareError("Failed to create catalog objects", error);
    throw error;
  }
}

async function setStockCounts(
  client: ReturnType<typeof createScriptClient>,
  locationId: string,
  variationIdBySku: Map<string, string>,
) {
  const occurredAt = new Date().toISOString();
  const changes = SEED_ITEMS.flatMap((item) =>
    item.variations.map((variation) => {
      const catalogObjectId = variationIdBySku.get(variation.sku);
      if (!catalogObjectId) {
        warn(`Skipping stock count for ${variation.sku} — variation not found in catalog.`);
        return null;
      }
      return {
        type: "PHYSICAL_COUNT" as const,
        physicalCount: {
          catalogObjectId,
          state: "IN_STOCK" as const,
          locationId,
          quantity: String(variation.startingQuantity),
          occurredAt,
        },
      };
    }),
  ).filter((change): change is NonNullable<typeof change> => change !== null);

  if (changes.length === 0) {
    warn("No stock counts to set.");
    return;
  }

  try {
    await client.inventory.batchCreateChanges({
      idempotencyKey: idempotencyKey(),
      changes,
    });
    success(`Set stock counts for ${changes.length} variation${changes.length === 1 ? "" : "s"}.`);
    for (const item of SEED_ITEMS) {
      for (const v of item.variations) {
        info(`  ${item.name} (${v.name}): ${v.startingQuantity} on hand, sku ${v.sku}`);
      }
    }
  } catch (error) {
    logSquareError("Failed to set stock counts", error);
    throw error;
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logSquareError("Inventory seed failed", error);
    process.exit(1);
  });
}

export { main };
