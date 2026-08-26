import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { makePdfWithText } from "./fixtures.js";

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
  return res.body.accessToken as string;
}

async function submitVerification(accessToken: string) {
  const pdf = await makePdfWithText(["A routine document submitted for queue-filter testing."]);
  const res = await request(app)
    .post("/verifications")
    .set("Authorization", `Bearer ${accessToken}`)
    .attach("file", pdf, { filename: "doc.pdf", contentType: "application/pdf" });
  return res.body.id as string;
}

describe("GET /verifications?reviewStatus=", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lists an unreviewed verification under NOT_REVIEWED and not under any other status", async () => {
    const accessToken = await registerOrg("Queue Filter Org 1");
    const verificationId = await submitVerification(accessToken);

    const notReviewed = await request(app)
      .get("/verifications?reviewStatus=NOT_REVIEWED")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(notReviewed.body.map((v: { id: string }) => v.id)).toContain(verificationId);
    expect(notReviewed.body.find((v: { id: string }) => v.id === verificationId).reviewStatus).toBe("NOT_REVIEWED");

    const inReview = await request(app)
      .get("/verifications?reviewStatus=IN_REVIEW")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(inReview.body.map((v: { id: string }) => v.id)).not.toContain(verificationId);
  });

  it("moves a verification out of NOT_REVIEWED and into the new status once a review event is recorded", async () => {
    const accessToken = await registerOrg("Queue Filter Org 2");
    const verificationId = await submitVerification(accessToken);

    await request(app)
      .post(`/verifications/${verificationId}/review`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "IN_REVIEW" });

    const inReview = await request(app)
      .get("/verifications?reviewStatus=IN_REVIEW")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(inReview.body.map((v: { id: string }) => v.id)).toContain(verificationId);

    const notReviewed = await request(app)
      .get("/verifications?reviewStatus=NOT_REVIEWED")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(notReviewed.body.map((v: { id: string }) => v.id)).not.toContain(verificationId);

    await request(app)
      .post(`/verifications/${verificationId}/review`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "CONFIRMED_MODIFICATION" });

    const confirmedModification = await request(app)
      .get("/verifications?reviewStatus=CONFIRMED_MODIFICATION")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(confirmedModification.body.map((v: { id: string }) => v.id)).toContain(verificationId);

    const stillInReview = await request(app)
      .get("/verifications?reviewStatus=IN_REVIEW")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(stillInReview.body.map((v: { id: string }) => v.id)).not.toContain(verificationId);
  });

  it("rejects an invalid reviewStatus filter value", async () => {
    const accessToken = await registerOrg("Queue Filter Org 3");
    const res = await request(app)
      .get("/verifications?reviewStatus=NOT_A_REAL_STATUS")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
  });

  it("never lets one organization's queue filter surface another organization's verifications", async () => {
    const orgA = await registerOrg("Queue Filter Org A");
    const orgB = await registerOrg("Queue Filter Org B");
    const verificationId = await submitVerification(orgA);

    const res = await request(app)
      .get("/verifications?reviewStatus=NOT_REVIEWED")
      .set("Authorization", `Bearer ${orgB}`);
    expect(res.body.map((v: { id: string }) => v.id)).not.toContain(verificationId);
  });
});

describe("submittedByName on /report and /investigation", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("surfaces the submitter's name on both endpoints", async () => {
    const accessToken = await registerOrg("Submitted By Name Org");
    const verificationId = await submitVerification(accessToken);

    const report = await request(app)
      .get(`/verifications/${verificationId}/report`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(report.body.document.submittedByName).toBe("Org Admin");

    const investigation = await request(app)
      .get(`/verifications/${verificationId}/investigation`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(investigation.body.document.submittedByName).toBe("Org Admin");
  });
});
