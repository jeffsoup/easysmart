import type { SquareClient } from "square";

/** IDs of all ACTIVE team members, for attributing orders/payments to staff. */
export async function listActiveTeamMemberIds(client: SquareClient): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.teamMembers.search({
      cursor,
      limit: 100,
      query: { filter: { status: "ACTIVE" } },
    });
    for (const member of response.teamMembers ?? []) {
      if (member.id) ids.push(member.id);
    }
    cursor = response.cursor;
  } while (cursor);

  return ids;
}
