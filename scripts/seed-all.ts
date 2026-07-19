/**
 * Runs every seed script in dependency order:
 *   inventory → team members → customers → orders → payments → payroll
 *
 * Team members and customers run before orders so seed-orders.ts can
 * attribute orders/payments to staff and buyers from the very first batch.
 *
 * Usage: npm run seed:all
 */
import { main as seedInventory } from "./inventory/seed-inventory";
import { main as seedTeamMembers } from "./team/seed-team-members";
import { main as seedCustomers } from "./customers/seed-customers";
import { main as seedOrders } from "./orders/seed-orders";
import { main as seedPayments } from "./payments/seed-payments";
import { main as seedPayroll } from "./payroll/seed-payroll";
import { logSquareError } from "./lib/log";

async function main() {
  await seedInventory();
  await seedTeamMembers();
  await seedCustomers();
  await seedOrders();
  await seedPayments();
  await seedPayroll();
}

main().catch((error) => {
  logSquareError("seed-all failed", error);
  process.exit(1);
});
