# Test data scripts

Standalone scripts that populate your Square **Sandbox** test account with
realistic data — inventory, orders, payments, team members, and payroll
(timecards) — so the dashboard has something to show without manually
clicking through the Sandbox Seller Dashboard.

These are separate from the Next.js app itself. The app authenticates a
seller via OAuth in the browser; these scripts talk to the Square API
directly with a sandbox access token, which is simpler for one-off CLI runs.

## Setup

1. Go to the [Square Developer Console](https://developer.squareup.com/apps) → your app → **Sandbox**.
2. Under **Sandbox Test Account**, copy the **Access Token** (starts with `EAAA...`).
3. Add it to `.env.local`:

   ```
   SQUARE_SANDBOX_ACCESS_TOKEN=EAAA...
   ```

4. Make sure the Sandbox test account has at least one **location** — open
   the Sandbox Seller Dashboard once if you haven't, so a default location
   exists.

That's it — `npm install` already pulled in `tsx`, which runs the scripts
directly from TypeScript.

## Running

Run everything in order:

```bash
npm run seed:all
```

Or run each piece on its own:

```bash
npm run seed:inventory   # categories, items, variations, starting stock counts
npm run seed:team        # jobs + team members with hourly/salary wage settings
npm run seed:customers   # a pool of customer profiles
npm run seed:orders      # orders against that catalog; most paid, some left open
npm run seed:payments    # pays off any open orders + a few standalone charges + one refund
npm run seed:payroll     # 30 days of closed timecards for hourly team members
```

Order matters if you run scripts individually: `seed:inventory` before
`seed:orders`, and `seed:team` / `seed:customers` before `seed:orders` /
`seed:payments` if you want orders and payments attributed to staff and
buyers (see "Team-member & customer attribution" below). `seed:orders` before
`seed:payments` is recommended but not required — `seed:payments` will just
find zero open orders to pay if none exist yet, and still creates its
standalone charges.

Every script is safe to run more than once. Inventory and team scripts check
for existing seed data (by SKU / job title / reference ID) before creating
duplicates. Orders, payments, and timecards always add new records, since
that's how a real business's data accumulates too.

### Options

```bash
npm run seed:orders -- --count=100     # default 40
npm run seed:payroll -- --shifts=20    # shifts per team member, default 15
```

## What gets created

| Script | Creates |
| --- | --- |
| `seed:inventory` | 3 categories, 9 items, starting stock counts — see "The inventory mix" below |
| `seed:team` | 4 jobs (Barista, Cashier, Shift Lead, Store Manager), 5 team members with wage settings (4 hourly, 1 salaried) |
| `seed:customers` | 10 customer profiles |
| `seed:orders` | ~40 orders with 1–4 line items each, ~85% paid and completed (each attributed to a random team member, ~65% also attributed to a random customer), ~15% left open |
| `seed:payments` | Pays off open orders (attributed to staff/customer same as above), records 3 standalone custom-amount payments (always attributed to a customer + team member), issues 1 sample refund |
| `seed:payroll` | ~15 closed timecards per hourly team member, spread across the last 29 days, with breaks on longer shifts |

## The inventory mix

`seed-inventory.ts` and `seed-orders.ts` share one dataset
(`lib/catalog-seed-data.ts`) so the resulting sales pattern isn't left to
random chance — each variation is tagged with a `profile`, and
`seed-orders.ts` reads those tags to decide what to sell:

| Item | Profile | How it's guaranteed |
| --- | --- | --- |
| Latte (12oz) | **Strong seller** | Added to every order at qty 3, against a large starting stock (250) — stays "healthy" but is unmistakably the top mover. |
| Cold Brew (16oz) | **Near-zero cover** | Added to every order at qty 2, against a small starting stock (8) — sell-through pushes `daysOfCover` under the 7-day reorder line. |
| Croissant | **Near-zero cover** (threshold path) | Starting stock (4) is already below its alert threshold (6), independent of sales — exercises the other low-stock branch in `inventory.ts`. |
| Blueberry Muffin, Ceramic Mug | **Dead stock** | `orderWeight: 0` — `seed-orders.ts` never selects them, no matter how many orders run, so they sit at 30/50 units with zero sales → slow mover. |
| Avocado Toast | **Out of stock** | Starting stock is 0. |
| Espresso, Chai Latte, House Blend Coffee Bag | **Healthy** | Normal starting stock, light random sales. |

This only works end to end if both scripts run against the same seeded
catalog — `seed:inventory` before `seed:orders`. If you skip `seed:inventory`,
`seed:orders` falls back to plain random selection across whatever's in the
catalog (and warns you).

The near-zero-cover math depends on order volume: at the default `--count=40`
(with ~85% completing), Cold Brew gets roughly 65+ units sold against 8 in
stock. Very low counts (below ~20) may not sell through enough to cross the
7-day line — use the default or higher if you want that item to reliably
show up as low stock.

## Team-member & customer attribution

Every payment `seed:orders` and `seed:payments` create is attributed to a
random active team member, using the pattern Square requires for this:

1. Create the order.
2. Create the payment against a Sandbox test card nonce (`cnon:card-nonce-ok`,
   not `CASH`), with `orderId` set to that order and `teamMemberId` set to the
   team member.

`scripts/lib/team.ts` resolves active team member IDs live from the Team API
(`teamMembers.search`) each run — nothing is hardcoded, so it keeps working
across Sandbox resets. If no active team members exist yet, both scripts warn
and fall back to creating payments without a `teamMemberId` rather than
failing outright — run `npm run seed:team` first for full attribution.

Customers work the same way, via `scripts/lib/customers.ts`
(`customers.list`): `seed-orders.ts` attaches a random customer to ~65% of
orders (the rest are anonymous walk-ins, which is realistic — not every sale
has a known buyer), and `payOrderInFull` carries that same `customerId`
through from the order onto its payment, so the two stay linked to the same
buyer. `seed:payments`'s standalone deposit/invoice payments always attach a
customer, since those inherently represent a specific buyer. Run
`npm run seed:customers` first for this; otherwise orders/payments are
created without a `customer_id`, same graceful fallback as team members.

## Known limitations

- **Orders and payments can't be backdated.** This is a Square API
  constraint, not a script limitation: `created_at` / `closed_at` on an
  Order are set server-side and there's no request field to override them
  (this is true in both Sandbox and production, and also applies to Virtual
  Terminal payments — anything you create "now" is dated "now"). So a single
  run of `seed:orders` / `seed:payments` produces a one-day spike of sales
  "today," not a smooth 30-day trend.

  If you want the Sales chart to show a real multi-day trend, the only way
  is to actually create orders on different real-world days. Run a small
  batch daily, e.g. via cron:

  ```cron
  # 10am every day — adjust the path, and keep --count modest for a daily top-up
  0 10 * * * cd /path/to/square-bi && /usr/local/bin/npm run seed:orders -- --count=10 >> seed.log 2>&1
  ```

  cron runs with a minimal environment, so test the command manually first
  (`npm run seed:orders -- --count=10`) and use full paths as shown.

- **Timecards *can* be backdated** (Square only rejects a `start_at` in the
  future), so `seed:payroll` gives you genuine 30-day labor history in one
  shot — no daily cron needed for labor data.
- **Labor cost % requires wage data.** `labor.ts` only computes
  `laborCostPctOfSales` when at least one closed timecard has a nonzero
  `wage.hourlyRate`; otherwise it stays blank. `seed:payroll` always sets an
  hourly rate on every timecard it creates (sourced from the team member's
  wage setting from `seed:team`), so this is covered as long as you run
  `seed:team` first.
- **Team members need a permission set before they can have a wage setting.**
  Square rejects `CreateTeamMember` if you include `wageSetting` inline unless
  the member already has a permission set assigned — and permission sets can
  only be assigned from the Dashboard, not the API. `seed:team` works around
  this by creating the team member bare first (which gets a default
  permission set automatically) and then attaching the wage setting with a
  separate `teamMembers.wageSetting.update` call.
- **There's no public "run payroll" API.** Square Payroll (the product) isn't
  exposed for writes via the public API — labor cost is estimated from
  Timecards × hourly wage, same as this app's own `labor.ts`. `seed:payroll`
  fills in that same data source rather than simulating an actual payroll run.
- **Resetting.** These scripts don't delete anything. To start over cleanly,
  use the Sandbox Dashboard's "Reset Test Account" option (Developer Console
  → your app → Sandbox) rather than trying to script deletions — Square
  doesn't allow deleting Orders/Payments via the API anyway.

## Safety rail

Every script refuses to run if `SQUARE_ENVIRONMENT=production`, unless you
also set `ALLOW_PRODUCTION_SEED=true`. This is test-data tooling — it's not
meant to touch a real seller account.

## Layout

```
scripts/
  lib/
    env.ts               # loads .env.local, resolves sandbox token + safety rail
    client.ts             # SquareClient + location lookup
    orders.ts             # shared order-payment helper (used by orders + payments scripts)
    catalog-seed-data.ts   # shared catalog + sales-profile dataset (inventory + orders scripts)
    team.ts                # active team member ID lookup (orders + payments scripts)
    customers.ts           # customer ID lookup (orders + payments scripts)
    random.ts              # idempotency keys, random/weighted picks, times
    log.ts                 # console output helpers
  inventory/seed-inventory.ts
  team/seed-team-members.ts
  customers/seed-customers.ts
  orders/seed-orders.ts
  payments/seed-payments.ts
  payroll/seed-payroll.ts
  seed-all.ts
```
