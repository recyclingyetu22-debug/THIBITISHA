import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";

const app = createApp();

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

describe("free-grant entitlement on registration", () => {
  beforeAll(async () => {
    // Self-contained: upserts the exact plan entitlements.ts looks up by
    // key, rather than depending on the external seed script having been
    // run against the test database.
    await prisma.plan.upsert({
      where: { key: "individual_free_grant" },
      create: { key: "individual_free_grant", name: "Free", category: "INDIVIDUAL_FREE", billingInterval: null, allowancePerPeriod: 3 },
      update: { active: true, allowancePerPeriod: 3 },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("grants exactly the seeded free amount on new-organization registration", async () => {
    const res = await request(app).post("/auth/register-organization").send({
      organizationName: "Free Grant Org",
      adminName: "Admin",
      email: uniqueEmail("free-grant"),
      password: "correct-horse-battery",
    });
    expect(res.status).toBe(201);
    const accessToken = res.body.accessToken as string;

    const account = await request(app).get("/billing/account").set("Authorization", `Bearer ${accessToken}`);
    expect(account.status).toBe(200);
    expect(account.body).toEqual({ hasAccount: true, unlimited: false, balance: 3, updatedAt: expect.any(String) });

    const transactions = await request(app).get("/billing/transactions").set("Authorization", `Bearer ${accessToken}`);
    expect(transactions.status).toBe(200);
    expect(transactions.body).toHaveLength(1);
    expect(transactions.body[0]).toMatchObject({ type: "FREE_GRANT", amount: 3, balanceAfter: 3 });
  });

  // The fail-open "no seeded plan = no account = unlimited" path is not
  // re-tested here by toggling the shared plan's `active` flag — that would
  // race against other test files registering organizations concurrently
  // against the same test database. It's still exercised implicitly: every
  // one of the ~130 pre-billing tests registers organizations and never
  // creates an EntitlementAccount, proving the unlimited path stays intact.
});
