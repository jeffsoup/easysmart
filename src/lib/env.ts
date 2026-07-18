function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  return value.includes("REPLACE_ME") || value.includes("...");
}

/** Soft check used by the UI before attempting OAuth. */
export function getSetupStatus() {
  const missing: string[] = [];
  if (!process.env.SESSION_SECRET) missing.push("SESSION_SECRET");
  if (isPlaceholder(process.env.SQUARE_APPLICATION_ID)) {
    missing.push("SQUARE_APPLICATION_ID");
  }
  if (isPlaceholder(process.env.SQUARE_APPLICATION_SECRET)) {
    missing.push("SQUARE_APPLICATION_SECRET");
  }

  return {
    ready: missing.length === 0,
    missing,
  };
}

export function getSquareConfig() {
  const environment =
    process.env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox";

  return {
    environment,
    applicationId: required("SQUARE_APPLICATION_ID"),
    applicationSecret: required("SQUARE_APPLICATION_SECRET"),
    redirectUri:
      process.env.SQUARE_REDIRECT_URI ??
      "http://localhost:3000/api/auth/callback",
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  };
}

export function getSessionPassword(): string {
  return required("SESSION_SECRET");
}

export const OAUTH_SCOPES = [
  "MERCHANT_PROFILE_READ",
  "REPORTING_READ",
  // Sandbox: Reporting API 404s; we aggregate completed Orders instead.
  "ORDERS_READ",
  "ITEMS_READ",
  "INVENTORY_READ",
  // Labor / payroll-adjacent (timecards + wages; not full payroll runs).
  "TIMECARDS_READ",
  "EMPLOYEES_READ",
  // Payment → order attribution for sales by team member.
  "PAYMENTS_READ",
] as const;
