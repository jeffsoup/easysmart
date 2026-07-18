import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Minimal .env parser — good enough for KEY=value lines, no deps required. */
function parseEnvFile(path: string): Record<string, string> {
  const values: Record<string, string> = {};
  if (!existsSync(path)) return values;

  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

let loaded = false;

/** Loads .env.local into process.env (without overriding already-set vars). */
export function loadEnv() {
  if (loaded) return;
  loaded = true;

  const parsed = parseEnvFile(resolve(REPO_ROOT, ".env.local"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function required(name: string): string {
  loadEnv();
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Set it in .env.local — see scripts/README.md.`,
    );
  }
  return value;
}

export type ScriptConfig = {
  environment: "sandbox" | "production";
  accessToken: string;
  locationId?: string;
};

/**
 * Config for standalone seed scripts. These call the Square API directly with
 * a sandbox access token (Developer Console → your app → Sandbox → Sandbox
 * Test Account), separate from the app's own browser OAuth flow.
 */
export function getScriptConfig(): ScriptConfig {
  loadEnv();
  const environment =
    process.env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox";

  // Hard safety rail: these scripts create fake orders, payments, team
  // members, and payroll data. Never let that happen against a real seller.
  if (environment === "production" && process.env.ALLOW_PRODUCTION_SEED !== "true") {
    throw new Error(
      "SQUARE_ENVIRONMENT is 'production'. Refusing to run seed scripts against a " +
        "production account. Set SQUARE_ENVIRONMENT=sandbox, or if you really mean " +
        "it, set ALLOW_PRODUCTION_SEED=true.",
    );
  }

  return {
    environment,
    accessToken: required("SQUARE_SANDBOX_ACCESS_TOKEN"),
    locationId: process.env.SQUARE_SANDBOX_LOCATION_ID || undefined,
  };
}
