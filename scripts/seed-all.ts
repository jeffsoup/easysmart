/**
 * Runs every seed script in dependency order:
 *   inventory → orders → payments → team members → payroll
 *
 * Usage: npm run seed:all
 */
import { main as seedInventory } from "./inventory/seed-inventory";
import { main as seedOrders } from "./orders/seed-orders";
import { main as seedPayments } from "./payments/seed-payments";
import { main as seedTeamMembers } from "./team/seed-team-members";
import { main as seedPayroll } from "./payroll/seed-payroll";
import { logSquareError } from "./lib/log";

async function main() {
  await seedInventory();
  await seedOrders();
  await seedPayments();
  await seedTeamMembers();
  await seedPayroll();
}

main().catch((error) => {
  logSquareError("seed-all failed", error);
  process.exit(1);
});
