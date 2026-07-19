import type { SquareClient } from "square";

/** IDs of all seeded Customer profiles, for attaching to orders/payments. */
export async function listCustomerIds(client: SquareClient): Promise<string[]> {
  const ids: string[] = [];
  const page = await client.customers.list({});
  for await (const customer of page) {
    if (customer.id) ids.push(customer.id);
  }
  return ids;
}
