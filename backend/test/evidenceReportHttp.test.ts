import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { makePdfWithHardEdgeEmbeddedImage, makePdfWithText } from "./fixtures.js";

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

async function registerReferenceDocument(accessToken: string, pdfBuffer: Buffer) {
  const res = await request(app)
    .post("/documents")
    .set("Authorization", `Bearer ${accessToken}`)
    .field("documentType", "certificate")
    .field("title", "Reference Document")
    .attach("file", pdfBuffer, { filename: "reference.pdf", contentType: "application/pdf" });
  return res.body.id as string;
}

describe("GET /verifications/:id/report — evidence report shape", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns all six report sections for a standalone verification", async () => {
    const accessToken = await registerOrg("Evidence Report Org 1");
    const { buffer } = await makePdfWithHardEdgeEmbeddedImage();

    const submit = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", buffer, { filename: "cert.pdf", contentType: "application/pdf" });
    expect(submit.status).toBe(201);

    const report = await request(app)
      .get(`/verifications/${submit.body.id}/report`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(report.status).toBe(200);
    const body = report.body;

    // Six distinguished sections.
    expect(body.findings).toBeDefined();
    expect(body.overallAssessment).toBeDefined();
    expect(body.coverage).toBeDefined();
    expect(body.coverage.modules).toBeInstanceOf(Array);
    expect(body.limitations).toBeInstanceOf(Array);
    expect(typeof body.recommendation).toBe("string");
    expect(body.referenceComparison).toEqual({ available: false, documentId: null, documentNumber: null });
    expect(body.issuerConfirmation).toEqual({ status: "NOT_REQUESTED", history: [] });

    // Plus the business/investigator split.
    expect(typeof body.executiveSummary).toBe("string");
    expect(body.executiveSummary.length).toBeGreaterThan(0);

    // The region-forensics finding should carry normalized regions.
    const regionFindings = body.findings.REGION_FORENSICS ?? [];
    expect(regionFindings.length).toBeGreaterThan(0);
    expect(regionFindings[0].regions).toBeInstanceOf(Array);
    expect(regionFindings[0].regions[0]).toHaveProperty("x");

    expect(body.correlatedFindings).toBeInstanceOf(Array);
  });

  it("returns referenceComparison.available = true for a reference-backed verification", async () => {
    const accessToken = await registerOrg("Evidence Report Org 2");
    const pdf = await makePdfWithText(["A simple reference-backed document."]);
    const referenceDocumentId = await registerReferenceDocument(accessToken, pdf);

    const submit = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${accessToken}`)
      .field("referenceDocumentId", referenceDocumentId)
      .attach("file", pdf, { filename: "copy.pdf", contentType: "application/pdf" });
    expect(submit.status).toBe(201);
    expect(submit.body.status).toBe("VERIFIED_MATCH");

    const report = await request(app)
      .get(`/verifications/${submit.body.id}/report`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(report.body.referenceComparison.available).toBe(true);
    expect(report.body.referenceComparison.documentId).toBe(referenceDocumentId);
    expect(report.body.overallAssessment.status).toBe("VERIFIED_MATCH");
  });
});
