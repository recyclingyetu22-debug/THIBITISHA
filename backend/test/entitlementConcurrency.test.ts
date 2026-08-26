import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { makePdfWithText } from "./fixtures.js";

const app = createApp();

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

describe("entitlement consumption under concurrency", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("never lets balance go negative when many requests race against a balance of 1", async () => {
    const register = await request(app).post("/auth/register-organization").send({
      organizationName: `Entitlement Concurrency Org ${Date.now()}`,
      adminName: "Admin",
      email: uniqueEmail("entitlement-concurrency"),
      password: "correct-horse-battery",
    });
    const organizationId = register.body.organization.id as string;
    const accessToken = register.body.accessToken as string;
    // upsert, not create — another test file's registration may have
    // already seeded/activated the free-grant plan in this shared test
    // database, in which case register-organization already auto-created
    // an account.
    await prisma.entitlementAccount.upsert({ where: { organizationId }, create: { organizationId, balance: 1 }, update: { balance: 1 } });

    const pdf = await makePdfWithText(["A document submitted many times at once."]);

    const REQUEST_COUNT = 12;
    // Genuinely concurrent at the DB level (Promise.all, not sequential
    // awaits) — the same pattern documentNumberConcurrency.test.ts already
    // proves works for the atomic upsert-increment on the document-number
    // counter; here it exercises consumeEntitlement's guarded UPDATE
    // (ledger.ts) against a starting balance of exactly 1.
    const responses = await Promise.all(
      Array.from({ length: REQUEST_COUNT }, () =>
        request(app)
          .post("/verifications")
          .set("Authorization", `Bearer ${accessToken}`)
          .attach("file", pdf, { filename: "concurrent.pdf", contentType: "application/pdf" }),
      ),
    );

    const successes = responses.filter((r) => r.status === 201);
    const rejections = responses.filter((r) => r.status === 402);
    expect(successes).toHaveLength(1);
    expect(rejections).toHaveLength(REQUEST_COUNT - 1);

    const account = await prisma.entitlementAccount.findUniqueOrThrow({ where: { organizationId } });
    expect(account.balance).toBe(0);

    const verificationCount = await prisma.verificationRequest.count({ where: { organizationId } });
    expect(verificationCount).toBe(1);
  });
});
