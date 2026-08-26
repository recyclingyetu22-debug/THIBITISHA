import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { submitVerification } from "../src/modules/verification/verification.service.js";
import type { AIAnalysisInput, AIAnalysisProvider, AIAnalysisResult } from "../src/modules/verification/analysis/aiIndicators.js";
import { makePdfWithText } from "./fixtures.js";

const app = createApp();

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

// Registers a fresh org and gives it a controlled starting balance directly
// (bypassing the free-grant plan entirely) — self-contained regardless of
// whether any Plan has been seeded in the test database.
async function registerOrgWithBalance(balance: number) {
  const res = await request(app).post("/auth/register-organization").send({
    organizationName: `Entitlement Consumption Org ${Date.now()}-${Math.random()}`,
    adminName: "Admin",
    email: uniqueEmail("entitlement-consumption"),
    password: "correct-horse-battery",
  });
  const organizationId = res.body.organization.id as string;
  const userId = res.body.user.id as string;
  const accessToken = res.body.accessToken as string;
  // upsert, not create — another test file's registration may have already
  // seeded/activated the free-grant plan in this shared test database, in
  // which case register-organization already auto-created an account.
  const account = await prisma.entitlementAccount.upsert({ where: { organizationId }, create: { organizationId, balance }, update: { balance } });
  return { organizationId, userId, accessToken, accountId: account.id };
}

class ThrowingAIAnalysisProvider implements AIAnalysisProvider {
  readonly name = "throwing-test-provider";
  readonly version = "0.0.1-test";
  async analyze(_input: AIAnalysisInput): Promise<AIAnalysisResult> {
    throw new Error("Simulated analysis failure");
  }
}

describe("entitlement consumption", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("decrements by exactly 1 on a successful verification", async () => {
    const { accessToken } = await registerOrgWithBalance(2);
    const pdf = await makePdfWithText(["A routine document for entitlement consumption testing."]);

    const submit = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", pdf, { filename: "doc.pdf", contentType: "application/pdf" });
    expect(submit.status).toBe(201);

    const account = await request(app).get("/billing/account").set("Authorization", `Bearer ${accessToken}`);
    expect(account.body.balance).toBe(1);

    const transactions = await request(app).get("/billing/transactions").set("Authorization", `Bearer ${accessToken}`);
    const consumption = transactions.body.find((t: { type: string }) => t.type === "VERIFICATION_CONSUMPTION");
    expect(consumption).toMatchObject({ amount: -1, balanceAfter: 1, referenceType: "VerificationRequest", referenceId: submit.body.id });
  });

  it("returns 402 and creates zero VerificationRequest rows when the balance is zero", async () => {
    const { organizationId, accessToken } = await registerOrgWithBalance(0);
    const pdf = await makePdfWithText(["A document that should never be accepted."]);

    const before = await prisma.verificationRequest.count({ where: { organizationId } });
    const submit = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", pdf, { filename: "doc.pdf", contentType: "application/pdf" });

    expect(submit.status).toBe(402);
    const after = await prisma.verificationRequest.count({ where: { organizationId } });
    expect(after).toBe(before);

    const account = await request(app).get("/billing/account").set("Authorization", `Bearer ${accessToken}`);
    expect(account.body.balance).toBe(0);
  });

  it("does not touch the balance for an unsupported file type (422)", async () => {
    const { accessToken } = await registerOrgWithBalance(2);

    const submit = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", Buffer.from("not a real document"), { filename: "notes.txt", contentType: "text/plain" });
    expect(submit.status).toBe(422);

    const account = await request(app).get("/billing/account").set("Authorization", `Bearer ${accessToken}`);
    expect(account.body.balance).toBe(2);
  });

  it("refunds the entitlement when analysis throws after consumption", async () => {
    const { organizationId, userId, accessToken, accountId } = await registerOrgWithBalance(2);
    const pdf = await makePdfWithText(["A document whose analysis will be forced to fail."]);

    await expect(
      submitVerification(organizationId, userId, { buffer: pdf, mimetype: "application/pdf", originalname: "doc.pdf" }, null, "WEB", {
        aiProvider: new ThrowingAIAnalysisProvider(),
      }),
    ).rejects.toThrow("Simulated analysis failure");

    const account = await request(app).get("/billing/account").set("Authorization", `Bearer ${accessToken}`);
    expect(account.body.balance).toBe(2);

    // Filtered to just the verification-related entries — registration may
    // have also produced a FREE_GRANT entry if another test file has
    // activated that plan in this shared test database.
    const transactions = await prisma.entitlementTransaction.findMany({
      where: { accountId, type: { in: ["VERIFICATION_CONSUMPTION", "VERIFICATION_REFUND"] } },
      orderBy: { createdAt: "asc" },
    });
    expect(transactions.map((t) => t.type)).toEqual(["VERIFICATION_CONSUMPTION", "VERIFICATION_REFUND"]);
  });
});
