import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";

const app = createApp();

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

async function registerOrgWithBalance(name: string, balance: number) {
  const res = await request(app).post("/auth/register-organization").send({
    organizationName: name,
    adminName: "Admin",
    email: uniqueEmail("billing-isolation"),
    password: "correct-horse-battery",
  });
  const organizationId = res.body.organization.id as string;
  const accessToken = res.body.accessToken as string;
  // upsert, not create — another test file's registration may have already
  // seeded/activated the free-grant plan in this shared test database, in
  // which case register-organization already auto-created an account.
  await prisma.entitlementAccount.upsert({ where: { organizationId }, create: { organizationId, balance }, update: { balance } });
  return accessToken;
}

describe("billing tenant isolation", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("never lets one organization read another organization's billing account, transactions, or usage", async () => {
    const orgAToken = await registerOrgWithBalance(`Billing Isolation Org A ${Date.now()}`, 7);
    const orgBToken = await registerOrgWithBalance(`Billing Isolation Org B ${Date.now()}`, 0);

    const accountA = await request(app).get("/billing/account").set("Authorization", `Bearer ${orgAToken}`);
    const accountB = await request(app).get("/billing/account").set("Authorization", `Bearer ${orgBToken}`);
    expect(accountA.body.balance).toBe(7);
    expect(accountB.body.balance).toBe(0);

    const transactionsA = await request(app).get("/billing/transactions").set("Authorization", `Bearer ${orgAToken}`);
    // Org B's request must never be able to see any of org A's transaction
    // rows — each org's transactions endpoint is scoped to its own account
    // only. (Not asserting an exact count/empty list: whichever org
    // registered first may have already picked up a FREE_GRANT transaction
    // from the free-grant plan another test file activates in this shared
    // test database — the isolation guarantee is what's under test here.)
    const transactionsB = await request(app).get("/billing/transactions").set("Authorization", `Bearer ${orgBToken}`);
    const orgAIds = new Set(transactionsA.body.map((t: { id: string }) => t.id));
    expect(transactionsB.body.some((t: { id: string }) => orgAIds.has(t.id))).toBe(false);

    const usageA = await request(app).get("/billing/usage").set("Authorization", `Bearer ${orgAToken}`);
    const usageB = await request(app).get("/billing/usage").set("Authorization", `Bearer ${orgBToken}`);
    expect(usageA.body.currentBalance).toBe(7);
    expect(usageB.body.currentBalance).toBe(0);
  });
});
