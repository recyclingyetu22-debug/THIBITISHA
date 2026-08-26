import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { makePdfWithText } from "./fixtures.js";

const app = createApp();

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

async function registerOrgWithRoles(orgName: string, roles: string[]) {
  const adminRes = await request(app).post("/auth/register-organization").send({
    organizationName: orgName,
    adminName: "Org Admin",
    email: uniqueEmail("admin"),
    password: "correct-horse-battery",
  });
  const adminToken = adminRes.body.accessToken as string;

  if (roles.length === 1 && roles[0] === "ORG_ADMIN") {
    return adminToken;
  }

  const userEmail = uniqueEmail("member");
  const createUserRes = await request(app)
    .post("/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ email: userEmail, name: "Member", password: "correct-horse-battery", roles });

  const loginRes = await request(app).post("/auth/login").send({ email: userEmail, password: "correct-horse-battery" });
  return { adminToken, memberToken: loginRes.body.accessToken as string, memberCreated: createUserRes.status };
}

describe("GET /verifications/:id/investigation", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns everything from /report plus reviewDecision and auditHistory", async () => {
    const accessToken = await registerOrgWithRoles("Investigation View Org 1", ["ORG_ADMIN"]);
    const pdf = await makePdfWithText(["A document for investigation-view testing."]);

    const submit = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${accessToken as string}`)
      .attach("file", pdf, { filename: "doc.pdf", contentType: "application/pdf" });
    expect(submit.status).toBe(201);

    await request(app)
      .post(`/verifications/${submit.body.id}/review`)
      .set("Authorization", `Bearer ${accessToken as string}`)
      .send({ status: "IN_REVIEW" });

    const report = await request(app)
      .get(`/verifications/${submit.body.id}/report`)
      .set("Authorization", `Bearer ${accessToken as string}`);

    const investigation = await request(app)
      .get(`/verifications/${submit.body.id}/investigation`)
      .set("Authorization", `Bearer ${accessToken as string}`);

    expect(investigation.status).toBe(200);
    // Everything /report has, present and identical.
    expect(investigation.body.document).toEqual(report.body.document);
    expect(investigation.body.overallAssessment).toEqual(report.body.overallAssessment);
    expect(investigation.body.assessmentConfidence).toBe(report.body.assessmentConfidence);
    expect(investigation.body.keyFindings).toEqual(report.body.keyFindings);
    expect(investigation.body.findings).toEqual(report.body.findings);
    expect(investigation.body.correlatedFindings).toEqual(report.body.correlatedFindings);
    expect(investigation.body.affectedPages).toEqual(report.body.affectedPages);
    expect(investigation.body.coverage).toEqual(report.body.coverage);
    expect(investigation.body.limitations).toEqual(report.body.limitations);
    expect(investigation.body.recommendation).toBe(report.body.recommendation);
    expect(investigation.body.referenceComparison).toEqual(report.body.referenceComparison);
    expect(investigation.body.issuerConfirmation).toEqual(report.body.issuerConfirmation);

    // Plus the two new sections.
    expect(investigation.body.reviewDecision.status).toBe("IN_REVIEW");
    expect(investigation.body.reviewDecision.history).toHaveLength(1);
    expect(investigation.body.auditHistory).toBeInstanceOf(Array);
    expect(investigation.body.auditHistory.length).toBeGreaterThan(0);
    const actions = investigation.body.auditHistory.map((e: { action: string }) => e.action);
    expect(actions).toContain("verification_created");
    expect(actions).toContain("analysis_completed");
    expect(actions).toContain("review_decision_recorded");
  });

  it("rejects a VERIFIER-only user (403) while /report still allows them", async () => {
    const result = await registerOrgWithRoles("Investigation View Org 2", ["VERIFIER"]);
    if (typeof result === "string") throw new Error("expected member token result");
    const { adminToken, memberToken } = result;

    const pdf = await makePdfWithText(["A document for role-gating testing."]);
    const submit = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("file", pdf, { filename: "doc.pdf", contentType: "application/pdf" });

    const reportAsVerifier = await request(app)
      .get(`/verifications/${submit.body.id}/report`)
      .set("Authorization", `Bearer ${memberToken}`);
    expect(reportAsVerifier.status).toBe(200);

    const investigationAsVerifier = await request(app)
      .get(`/verifications/${submit.body.id}/investigation`)
      .set("Authorization", `Bearer ${memberToken}`);
    expect(investigationAsVerifier.status).toBe(403);
  });

  it("never lets one organization read another organization's investigation view", async () => {
    const orgA = await registerOrgWithRoles("Investigation View Org A", ["ORG_ADMIN"]);
    const orgB = await registerOrgWithRoles("Investigation View Org B", ["ORG_ADMIN"]);
    const pdf = await makePdfWithText(["Org A's confidential document."]);

    const submit = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${orgA as string}`)
      .attach("file", pdf, { filename: "doc.pdf", contentType: "application/pdf" });

    const res = await request(app)
      .get(`/verifications/${submit.body.id}/investigation`)
      .set("Authorization", `Bearer ${orgB as string}`);
    expect(res.status).toBe(404);
  });
});
