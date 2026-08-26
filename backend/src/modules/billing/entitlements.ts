import type { Prisma, PrismaClient } from "@prisma/client";
import { grantEntitlement } from "./ledger.js";

type TransactionClient = Prisma.TransactionClient | PrismaClient;

const FREE_GRANT_PLAN_KEY = "individual_free_grant";

export async function getEntitlementAccount(prisma: PrismaClient, organizationId: string) {
  return prisma.entitlementAccount.findUnique({ where: { organizationId } });
}

// Called from inside register-organization's existing transaction. Looks
// up the seeded free-grant Plan for its configured amount — never a
// hard-coded number in application code (per the "configuration-driven,
// not hard-coded" requirement). If the plan hasn't been seeded yet (a fresh
// database), this is a deliberate no-op: the new organization simply gets
// no EntitlementAccount, which is the same fail-open "unlimited" state
// every organization has today. Billing only starts gating once the
// business has actually configured a free-grant plan.
export async function provisionAccountForNewOrganization(tx: TransactionClient, organizationId: string): Promise<void> {
  const freeGrantPlan = await tx.plan.findUnique({ where: { key: FREE_GRANT_PLAN_KEY } });
  if (!freeGrantPlan || !freeGrantPlan.active || freeGrantPlan.allowancePerPeriod === null) {
    return;
  }

  const account = await tx.entitlementAccount.create({ data: { organizationId, balance: 0 } });
  await grantEntitlement(tx, account.id, "FREE_GRANT", freeGrantPlan.allowancePerPeriod, "Plan", freeGrantPlan.id);
}
