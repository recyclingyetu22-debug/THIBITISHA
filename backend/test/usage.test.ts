import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { usagePeriodStart } from "../src/modules/billing/usage.js";
import { makePdfWithText } from "./fixtures.js";

describe("usagePeriodStart", () => {
  it("buckets a date to the first of its UTC month", () => {
    expect(usagePeriodStart(new Date("2026-08-24T15:42:00Z"))).toEqual(new Date("2026-08-01T00:00:00.000Z"));
    expect(usagePeriodStart(new Date("2026-01-31T23:59:59Z"))).toEqual(new Date("2026-01-01T00:00:00.000Z"));
  });
});

const app = createApp();

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

async function registerOrg(orgName: string) {
  const res = await request(app).post("/auth/register-organization").send({
    organizationName: orgName,
    adminName: "Org Admin",
    email: uniqueEmail("officer"),
    password: "correct-horse-battery",
  });
  return { accessToken: res.body.accessToken as string, organizationId: res.body.organization.id as string, userId: res.body.user.id as string };
}

describe("usage recording on submitVerification (HTTP)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates exactly one UsageRecord for a successful verification, defaulting platform to WEB", async () => {
    const { accessToken, organizationId, userId } = await registerOrg("Usage Org 1");
    const pdf = await makePdfWithText(["A routine document for usage-recording testing."]);

    const submit = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", pdf, { filename: "doc.pdf", contentType: "application/pdf" });
    expect(submit.status).toBe(201);

    const usageRecords = await prisma.usageRecord.findMany({ where: { verificationRequestId: submit.body.id } });
    expect(usageRecords).toHaveLength(1);
    expect(usageRecords[0].organizationId).toBe(organizationId);
    expect(usageRecords[0].userId).toBe(userId);
    expect(usageRecords[0].platform).toBe("WEB");

    const verificationRequest = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: submit.body.id } });
    expect(verificationRequest.platform).toBe("WEB");
  });

  it("respects the X-Client-Platform header on both VerificationRequest and UsageRecord", async () => {
    const { accessToken } = await registerOrg("Usage Org 2");
    const pdf = await makePdfWithText(["A document submitted from a mobile client."]);

    const submit = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("X-Client-Platform", "MOBILE")
      .attach("file", pdf, { filename: "doc.pdf", contentType: "application/pdf" });
    expect(submit.status).toBe(201);

    const verificationRequest = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: submit.body.id } });
    expect(verificationRequest.platform).toBe("MOBILE");

    const usageRecords = await prisma.usageRecord.findMany({ where: { verificationRequestId: submit.body.id } });
    expect(usageRecords[0].platform).toBe("MOBILE");
  });

  it("creates no UsageRecord for a file that fails validation", async () => {
    const { accessToken } = await registerOrg("Usage Org 3");

    const before = await prisma.usageRecord.count();
    const submit = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", Buffer.from("not a real document"), { filename: "note.txt", contentType: "text/plain" });
    expect(submit.status).toBe(422);

    const after = await prisma.usageRecord.count();
    expect(after).toBe(before);
  });
});
