import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { deriveCurrentStatus } from "../src/modules/verification/issuerConfirmation.js";
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
  const pdf = await makePdfWithText(["A routine document submitted for issuer-confirmation testing."]);
  const res = await request(app)
    .post("/verifications")
    .set("Authorization", `Bearer ${accessToken}`)
    .attach("file", pdf, { filename: "doc.pdf", contentType: "application/pdf" });
  return res.body.id as string;
}

describe("deriveCurrentStatus", () => {
  it("returns NOT_REQUESTED for an empty history", () => {
    expect(deriveCurrentStatus([])).toBe("NOT_REQUESTED");
  });

  it("returns the most recent event's status, not the first", () => {
    const history = [
      { id: "1", status: "REQUESTED" as const, recordedById: "u1", contactMethod: null, notes: null, createdAt: new Date("2026-01-01") },
      { id: "2", status: "CONFIRMED_GENUINE" as const, recordedById: "u1", contactMethod: null, notes: null, createdAt: new Date("2026-01-02") },
    ];
    expect(deriveCurrentStatus(history)).toBe("CONFIRMED_GENUINE");
  });
});

describe("issuer confirmation workflow (HTTP)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("records a REQUESTED event then a response, and the history/derived status reflect both in order", async () => {
    const accessToken = await registerOrg("Issuer Confirmation Org 1");
    const verificationId = await submitVerification(accessToken);

    const requested = await request(app)
      .post(`/verifications/${verificationId}/issuer-confirmation`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "REQUESTED", contactMethod: "email", notes: "Emailed the registrar's office." });
    expect(requested.status).toBe(201);
    expect(requested.body.status).toBe("REQUESTED");

    const confirmed = await request(app)
      .post(`/verifications/${verificationId}/issuer-confirmation`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "CONFIRMED_GENUINE", contactMethod: "email", notes: "Registrar confirmed issuance." });
    expect(confirmed.status).toBe(201);

    const history = await request(app)
      .get(`/verifications/${verificationId}/issuer-confirmation`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(history.body).toHaveLength(2);
    expect(history.body[0].status).toBe("REQUESTED");
    expect(history.body[1].status).toBe("CONFIRMED_GENUINE");

    const report = await request(app)
      .get(`/verifications/${verificationId}/report`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(report.body.issuerConfirmation.status).toBe("CONFIRMED_GENUINE");
    expect(report.body.issuerConfirmation.history).toHaveLength(2);
  });

  it("never alters the original forensic assessment/findings when issuer confirmation is recorded", async () => {
    const accessToken = await registerOrg("Issuer Confirmation Org 2");
    const verificationId = await submitVerification(accessToken);

    const before = await request(app)
      .get(`/verifications/${verificationId}/report`)
      .set("Authorization", `Bearer ${accessToken}`);

    await request(app)
      .post(`/verifications/${verificationId}/issuer-confirmation`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "REQUESTED" });
    await request(app)
      .post(`/verifications/${verificationId}/issuer-confirmation`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "DENIED_ISSUANCE", notes: "Issuer states this was never issued." });

    const after = await request(app)
      .get(`/verifications/${verificationId}/report`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(after.body.overallAssessment).toEqual(before.body.overallAssessment);
    expect(after.body.findings).toEqual(before.body.findings);
    expect(after.body.correlatedFindings).toEqual(before.body.correlatedFindings);
    expect(after.body.assessmentConfidence).toBe(before.body.assessmentConfidence);
    // Only the issuer-confirmation section itself should have changed.
    expect(after.body.issuerConfirmation.status).toBe("DENIED_ISSUANCE");
  });

  it("never lets one organization record or read another organization's issuer-confirmation events", async () => {
    const orgA = await registerOrg("Issuer Confirmation Org A");
    const orgB = await registerOrg("Issuer Confirmation Org B");
    const verificationId = await submitVerification(orgA);

    const crossOrgPost = await request(app)
      .post(`/verifications/${verificationId}/issuer-confirmation`)
      .set("Authorization", `Bearer ${orgB}`)
      .send({ status: "REQUESTED" });
    expect(crossOrgPost.status).toBe(404);

    const crossOrgGet = await request(app)
      .get(`/verifications/${verificationId}/issuer-confirmation`)
      .set("Authorization", `Bearer ${orgB}`);
    expect(crossOrgGet.status).toBe(404);
  });

  it("rejects an invalid status value", async () => {
    const accessToken = await registerOrg("Issuer Confirmation Org 3");
    const verificationId = await submitVerification(accessToken);

    const res = await request(app)
      .post(`/verifications/${verificationId}/issuer-confirmation`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "MAYBE" });
    expect(res.status).toBe(400);
  });
});
