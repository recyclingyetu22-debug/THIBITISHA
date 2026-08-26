import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { CORRUPTED_PDF_BYTES, makePdfWithText } from "./fixtures.js";

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

describe("standalone verification engine", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("analyzes a normal PDF with no reference and completes without crashing", async () => {
    const accessToken = await registerOrg("Standalone Org 1");
    const pdf = await makePdfWithText(["This is a routine invoice.", "Total amount due: 500 USD."]);

    const res = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", pdf, { filename: "invoice.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(201);
    expect(["LOW_CONCERN", "SUSPICIOUS", "HIGH_RISK"]).toContain(res.body.status);
    expect(res.body.hashMatch).toBeNull();
    // No-reference statuses must never claim authenticity.
    expect(res.body.recommendation).toMatch(/does not independently verify/i);
  });

  it("rejects an unsupported file type with a clean error, not a crash", async () => {
    const accessToken = await registerOrg("Standalone Org 2");

    const res = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", Buffer.from("just some random bytes, not a real file type"), {
        filename: "mystery.bin",
        contentType: "application/octet-stream",
      });

    expect(res.status).toBe(422);
  });

  it("classifies a corrupted PDF (valid magic bytes, unparseable body) as INCONCLUSIVE, never a 500", async () => {
    const accessToken = await registerOrg("Standalone Org 3");

    const res = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", CORRUPTED_PDF_BYTES, { filename: "broken.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("INCONCLUSIVE");
  });

  it("VERIFIED_MATCH when the submission is byte-identical to the supplied reference, without running extraction", async () => {
    const accessToken = await registerOrg("Standalone Org 4");
    const pdf = await makePdfWithText(["Certificate of completion.", "Awarded to: Jane Doe."]);
    const referenceDocumentId = await registerReferenceDocument(accessToken, pdf);

    const res = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${accessToken}`)
      .field("referenceDocumentId", referenceDocumentId)
      .attach("file", pdf, { filename: "copy.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("VERIFIED_MATCH");
    expect(res.body.hashMatch).toBe(true);
    expect(res.body.recommendation).toMatch(/does not independently establish/i);
  });

  it("MODIFIED when the submission's text differs from the supplied reference, and shows the actual changed text", async () => {
    const accessToken = await registerOrg("Standalone Org 5");
    const original = await makePdfWithText(["Meeting held at Kabale to place boundary stones."]);
    const edited = await makePdfWithText(["Meeting held at Kabale. Escorted by Bayingana Yvan to place boundary stones."]);
    const referenceDocumentId = await registerReferenceDocument(accessToken, original);

    const res = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${accessToken}`)
      .field("referenceDocumentId", referenceDocumentId)
      .attach("file", edited, { filename: "edited.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("MODIFIED");
    expect(res.body.hashMatch).toBe(false);

    const report = await request(app)
      .get(`/verifications/${res.body.id}/report`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(report.status).toBe(200);
    const referenceFindings = report.body.findings.REFERENCE_COMPARISON;
    expect(referenceFindings).toBeDefined();
    const textDiffFinding = referenceFindings.find((f: { evidence?: { changedSpans?: unknown[] } }) => f.evidence?.changedSpans);
    expect(textDiffFinding).toBeDefined();
    const addedSpan = textDiffFinding.evidence.changedSpans.find((s: { added?: boolean; value: string }) => s.added);
    expect(addedSpan.value).toContain("Bayingana Yvan");
  });

  it("never lets one organization read another organization's verification", async () => {
    const orgA = await registerOrg("Standalone Org A");
    const orgB = await registerOrg("Standalone Org B");
    const pdf = await makePdfWithText(["Org A confidential document."]);

    const created = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${orgA}`)
      .attach("file", pdf, { filename: "doc.pdf", contentType: "application/pdf" });

    const crossOrgRead = await request(app)
      .get(`/verifications/${created.body.id}`)
      .set("Authorization", `Bearer ${orgB}`);
    expect(crossOrgRead.status).toBe(404);

    const crossOrgList = await request(app).get("/verifications").set("Authorization", `Bearer ${orgB}`);
    expect(crossOrgList.body).toEqual([]);
  });
});
