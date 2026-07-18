/**
 * Single source of truth for the seeded catalog, shared by seed-inventory.ts
 * (creates items + starting stock) and seed-orders.ts (decides what sells).
 *
 * Each variation is tagged with a `profile` so the seed data deliberately
 * exercises every InventoryStatus rule in src/lib/inventory.ts, instead of
 * leaving the mix to chance:
 *
 *  - strong_seller:    high, guaranteed sell-through against generous stock —
 *                      stays "healthy" but is unmistakably the top mover.
 *  - near_zero_cover:  low stock relative to guaranteed sell-through, so
 *                      daysOfCover lands under the 7-day reorder line.
 *  - dead_stock:       decent stock, ZERO sales (orderWeight 0 — seed-orders
 *                      never picks these) → slow_mover.
 *  - out_of_stock:     starting quantity of 0, regardless of sales.
 *  - healthy:          moderate stock and light, un-forced sales.
 */
export type SalesProfile =
  | "strong_seller"
  | "near_zero_cover"
  | "dead_stock"
  | "out_of_stock"
  | "healthy";

export type SeedVariation = {
  sku: string;
  name: string;
  priceCents: number;
  alertThreshold: number;
  /** Starting on-hand quantity — chosen to produce a mix of health states. */
  startingQuantity: number;
  profile: SalesProfile;
  /**
   * Relative weight when seed-orders.ts fills the non-forced line items on
   * an order. 0 means "never sold" (dead stock / out of stock).
   */
  orderWeight: number;
  /** If set, this variation is added to every order at this quantity, to
   * guarantee its sales profile instead of leaving it to random chance. */
  forcedQuantity?: number;
};

export type SeedItem = {
  category: string;
  name: string;
  description: string;
  variations: SeedVariation[];
};

export const SEED_ITEMS: SeedItem[] = [
  {
    category: "Drinks",
    name: "Latte",
    description: "Espresso with steamed milk.",
    variations: [
      {
        sku: "SBI-LAT-12OZ",
        name: "12oz",
        priceCents: 475,
        alertThreshold: 10,
        startingQuantity: 250,
        profile: "strong_seller",
        orderWeight: 1,
        forcedQuantity: 3,
      },
    ],
  },
  {
    category: "Drinks",
    name: "Espresso",
    description: "Double shot, house blend.",
    variations: [
      {
        sku: "SBI-ESP-12OZ",
        name: "12oz",
        priceCents: 350,
        alertThreshold: 5,
        startingQuantity: 45,
        profile: "healthy",
        orderWeight: 2,
      },
    ],
  },
  {
    category: "Drinks",
    name: "Cold Brew",
    description: "Steeped 18 hours.",
    variations: [
      {
        sku: "SBI-CLDB-16OZ",
        name: "16oz",
        priceCents: 495,
        alertThreshold: 5,
        startingQuantity: 8,
        profile: "near_zero_cover",
        orderWeight: 1,
        forcedQuantity: 2,
      },
    ],
  },
  {
    category: "Drinks",
    name: "Chai Latte",
    description: "Spiced chai with steamed milk.",
    variations: [
      {
        sku: "SBI-CHAI-12OZ",
        name: "12oz",
        priceCents: 450,
        alertThreshold: 5,
        startingQuantity: 20,
        profile: "healthy",
        orderWeight: 1,
      },
    ],
  },
  {
    category: "Food",
    name: "Croissant",
    description: "Baked fresh daily.",
    variations: [
      {
        sku: "SBI-CROI-EA",
        name: "Each",
        priceCents: 375,
        alertThreshold: 6,
        // Below alertThreshold from the start — near-zero cover regardless
        // of how much it happens to sell (a second, threshold-triggered
        // path to low_stock, distinct from Cold Brew's sales-driven one).
        startingQuantity: 4,
        profile: "near_zero_cover",
        orderWeight: 1,
      },
    ],
  },
  {
    category: "Food",
    name: "Blueberry Muffin",
    description: "Baked fresh daily.",
    variations: [
      {
        sku: "SBI-MUFF-EA",
        name: "Each",
        priceCents: 350,
        alertThreshold: 6,
        startingQuantity: 30,
        profile: "dead_stock",
        orderWeight: 0,
      },
    ],
  },
  {
    category: "Food",
    name: "Avocado Toast",
    description: "Sourdough, chili flake, lime.",
    variations: [
      {
        sku: "SBI-AVTO-EA",
        name: "Each",
        priceCents: 850,
        alertThreshold: 4,
        startingQuantity: 0,
        profile: "out_of_stock",
        orderWeight: 0,
      },
    ],
  },
  {
    category: "Retail",
    name: "House Blend Coffee Bag",
    description: "Whole bean, 12oz bag.",
    variations: [
      {
        sku: "SBI-BEAN-12OZ",
        name: "12oz bag",
        priceCents: 1600,
        alertThreshold: 3,
        startingQuantity: 60,
        profile: "healthy",
        orderWeight: 1,
      },
    ],
  },
  {
    category: "Retail",
    name: "Ceramic Mug",
    description: "Branded 12oz ceramic mug.",
    variations: [
      {
        sku: "SBI-MUG-12OZ",
        name: "12oz",
        priceCents: 1400,
        alertThreshold: 3,
        startingQuantity: 50,
        profile: "dead_stock",
        orderWeight: 0,
      },
    ],
  },
];

export function allSeedVariations(): SeedVariation[] {
  return SEED_ITEMS.flatMap((item) => item.variations);
}
