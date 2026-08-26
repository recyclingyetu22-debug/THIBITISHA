// Idempotent — safe to re-run (upserts by Plan.key). Inserts the example
// commercial catalog as rows, not hard-coded application-code numbers, so
// pricing/allowances can be changed by editing data, not redeploying code.
// The free-grant plan (`individual_free_grant`) is the one entitlements.ts
// looks up at registration time; if this script is never run, new
// organizations simply get no EntitlementAccount (fail-open to unlimited —
// see the schema comment on Organization.planId).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface PlanSeed {
  key: string;
  name: string;
  description: string;
  category: "INDIVIDUAL_FREE" | "INDIVIDUAL_PAID" | "ORGANIZATION" | "ENTERPRISE" | "API";
  billingInterval: "ONE_TIME" | "MONTHLY" | "ANNUAL" | null;
  allowancePerPeriod: number;
  priceUsdCents: number | null; // null = not purchasable via checkout (the free grant)
}

const PLANS: PlanSeed[] = [
  { key: "individual_free_grant", name: "Free", description: "Granted automatically when you register.", category: "INDIVIDUAL_FREE", billingInterval: null, allowancePerPeriod: 3, priceUsdCents: null },
  { key: "starter_package", name: "Starter", description: "A small one-time verification package.", category: "INDIVIDUAL_PAID", billingInterval: "ONE_TIME", allowancePerPeriod: 5, priceUsdCents: 499 },
  { key: "basic_package", name: "Basic", description: "A one-time verification package.", category: "INDIVIDUAL_PAID", billingInterval: "ONE_TIME", allowancePerPeriod: 15, priceUsdCents: 1299 },
  { key: "professional_package", name: "Professional", description: "A larger one-time verification package.", category: "INDIVIDUAL_PAID", billingInterval: "ONE_TIME", allowancePerPeriod: 50, priceUsdCents: 3999 },
  { key: "business_package", name: "Business", description: "A high-volume one-time verification package for teams.", category: "ORGANIZATION", billingInterval: "ONE_TIME", allowancePerPeriod: 200, priceUsdCents: 14999 },
  { key: "personal_monthly", name: "Personal", description: "Monthly subscription for individuals.", category: "INDIVIDUAL_PAID", billingInterval: "MONTHLY", allowancePerPeriod: 20, priceUsdCents: 999 },
  { key: "professional_monthly", name: "Professional", description: "Monthly subscription for organizations.", category: "ORGANIZATION", billingInterval: "MONTHLY", allowancePerPeriod: 150, priceUsdCents: 7999 },
];

async function main() {
  for (const seed of PLANS) {
    const plan = await prisma.plan.upsert({
      where: { key: seed.key },
      create: {
        key: seed.key,
        name: seed.name,
        description: seed.description,
        category: seed.category,
        billingInterval: seed.billingInterval,
        allowancePerPeriod: seed.allowancePerPeriod,
      },
      update: {
        name: seed.name,
        description: seed.description,
        category: seed.category,
        billingInterval: seed.billingInterval,
        allowancePerPeriod: seed.allowancePerPeriod,
      },
    });

    if (seed.priceUsdCents !== null) {
      const existing = await prisma.pricing.findFirst({ where: { planId: plan.id, currency: "USD", country: null } });
      if (existing) {
        await prisma.pricing.update({ where: { id: existing.id }, data: { amount: seed.priceUsdCents, active: true } });
      } else {
        await prisma.pricing.create({ data: { planId: plan.id, currency: "USD", amount: seed.priceUsdCents, country: null } });
      }
    }
    console.log(`seeded plan: ${seed.key}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
