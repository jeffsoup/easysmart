# Square BI Light

MVP scaffold: connect a Square Sandbox seller via OAuth, then show **daily net sales for the last 30 days** from the Square Reporting API.

## Prerequisites

1. A [Square Developer](https://developer.squareup.com/) account
2. An application in the Developer Console
3. At least one Sandbox test account (seller)

## Setup

```bash
cd business-intelligence/square-bi
cp .env.example .env.local
npm install
```

Fill in `.env.local` with Sandbox credentials from **Developer Console → your app → Sandbox → OAuth**:

| Variable | Where to find it |
| --- | --- |
| `SQUARE_APPLICATION_ID` | Application ID |
| `SQUARE_APPLICATION_SECRET` | Application secret |
| `SQUARE_REDIRECT_URI` | Must match a registered Redirect URL |
| `SESSION_SECRET` | Any random string ≥ 32 characters |

Register this Redirect URL exactly:

```
http://localhost:3000/api/auth/callback
```

Requested OAuth scopes:

- `MERCHANT_PROFILE_READ`
- `REPORTING_READ`

## Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), click **Connect Square Sandbox**, and authorize with a Sandbox test seller.

> Sandbox tip: open the Sandbox seller Dashboard first, then complete OAuth from there if Square asks you to authenticate the test account.

## What this proves

1. OAuth code flow against Square Sandbox
2. Encrypted cookie session (`iron-session`) for the seller token
3. Reporting query via `ReportingHelper.loadAndWait`:

```json
{
  "measures": ["Sales.net_sales"],
  "timeDimensions": [{
    "dimension": "Sales.local_reporting_timestamp",
    "dateRange": "last 30 days",
    "granularity": "day"
  }]
}
```

## Project layout

```
src/
  app/
    page.tsx                 # Connect screen
    dashboard/page.tsx       # Merchant home + sales chart
    api/auth/login|callback|logout
  lib/
    square.ts                # SquareClient helpers + authorize URL
    reporting.ts             # Daily net sales query
    session.ts               # iron-session
  components/SalesChart.tsx
```

## Test data

To populate your Sandbox account with realistic inventory, orders, payments,
team members, and payroll data, see [`scripts/README.md`](scripts/README.md):

```bash
npm run seed:all
```

## Next phases

1. Persist tokens in Postgres (instead of cookie-only)
2. Inventory sync + dead-stock / reorder insights
3. Team + Labor insights (payroll-adjacent)

## Notes

- Reporting data is typically ~15 minutes behind live POS activity.
- Tokens in cookies are fine for a local prototype; production should store encrypted tokens server-side and refresh before expiry.
