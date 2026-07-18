import { SquareClient, SquareEnvironment } from "square";
import { getScriptConfig } from "./env";

/** Authenticated Square client for the sandbox test seller, for use in seed scripts. */
export function createScriptClient(): SquareClient {
  const { environment, accessToken } = getScriptConfig();

  return new SquareClient({
    environment:
      environment === "production"
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox,
    token: accessToken,
  });
}

/** The seller's location IDs, optionally narrowed to SQUARE_SANDBOX_LOCATION_ID. */
export async function listLocationIds(client: SquareClient): Promise<string[]> {
  const { locationId } = getScriptConfig();
  if (locationId) return [locationId];

  const response = await client.locations.list();
  const ids = (response.locations ?? [])
    .map((location) => location.id)
    .filter((id): id is string => Boolean(id));

  if (ids.length === 0) {
    throw new Error(
      "No Square locations found for this sandbox account. Create one in the " +
        "Sandbox Dashboard first.",
    );
  }

  return ids;
}
