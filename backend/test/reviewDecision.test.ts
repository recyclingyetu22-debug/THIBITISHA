import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { deriveCurrentReviewStatus } from "../src/modules/verification/reviewDecision.js";
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
  const pdf = await makePdfWithText(["A routine document submitted for reviewer-workflow testing."]);
  const res = await request(app)
    .post("/verifications")
    .set("Authorization", `Bearer ${accessToken}`)
    .attach("file", pdf, { filename: "doc.pdf", contentType: "application/pdf" });
  return res.body.id as string;
}

describe("deriveCurrentReviewStatus", () => {
  it("returns NOT_REVIEWED for an empty history", () => {
    expect(deriveCurrentReviewStatus([])).toBe("NOT_REVIEWED");
  });

  it("returns the most recent event's status, not the first", () => {
    const history = [
      { id: "1", status: "IN_REVIEW" as const, reviewedById: "u1", notes: null, createdAt: new Date("2026-01-01") },
      { id: "2", status: "CONFIRMED_MODIFICATION" as const, reviewedById: "u1", notes: null, createdAt: new Date("2026-01-02") },
    ];
    expect(deriveCurrentReviewStatus(history)).toBe("CONFIRMED_MODIFICATION");
  });
});

describe("reviewer decision workflow (HTTP)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("records IN_REVIEW then a decision, and the history/derived status reflect both in order", async () => {
    const accessToken = await registerOrg("Review Workflow Org 1");
    const verificationId = await submitVerification(accessToken);

    const inReview = await request(app)
      .post(`/verifications/${verificationId}/review`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "IN_REVIEW", notes: "Starting review." });
    expect(inReview.status).toBe(201);
    expect(inReview.body.status).toBe("IN_REVIEW");

    const decision = await request(app)
      .post(`/verifications/${verificationId}/review`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "CONFIRMED_MODIFICATION", notes: "Confirmed manipulation on page 1." });
    expect(decision.status).toBe(201);

    const history = await request(app)
      .get(`/verifications/${verificationId}/review`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(history.body).toHaveLength(2);
    expect(history.body[0].status).toBe("IN_REVIEW");
    expect(history.body[1].status).toBe("CONFIRMED_MODIFICATION");
  });

  it("never alters the original forensic assessment/findings/issuer confirmation when a review decision is recorded", async () => {
    const accessToken = await registerOrg("Review Workflow Org 2");
    const verificationId = await submitVerification(accessToken);

    await request(app)
      .post(`/verifications/${verificationId}/issuer-confirmation`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "REQUESTED" });

    const before = await request(app)
      .get(`/verifications/${verificationId}/report`)
      .set("Authorization", `Bearer ${accessToken}`);

    await request(app)
      .post(`/verifications/${verificationId}/review`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "FALSE_POSITIVE", notes: "Reviewed and determined the flags were false positives." });

    const after = await request(app)
      .get(`/verifications/${verificationId}/report`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(after.body.overallAssessment).toEqual(before.body.overallAssessment);
    expect(after.body.findings).toEqual(before.body.findings);
    expect(after.body.issuerConfirmation).toEqual(before.body.issuerConfirmation);
    expect(after.body.assessmentConfidence).toBe(before.body.assessmentConfidence);
  });

  it("never lets one organization record or read another organization's review events", async () => {
    const orgA = await registerOrg("Review Workflow Org A");
    const orgB = await registerOrg("Review Workflow Org B");
    const verificationId = await submitVerification(orgA);

    const crossOrgPost = await request(app)
      .post(`/verifications/${verificationId}/review`)
      .set("Authorization", `Bearer ${orgB}`)
      .send({ status: "IN_REVIEW" });
    expect(crossOrgPost.status).toBe(404);

    const crossOrgGet = await request(app)
      .get(`/verifications/${verificationId}/review`)
      .set("Authorization", `Bearer ${orgB}`);
    expect(crossOrgGet.status).toBe(404);
  });
});
