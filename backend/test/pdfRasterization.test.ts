import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { extractText } from "../src/modules/verification/textExtraction.js";
import { rasterizePdfPages } from "../src/modules/verification/pdfRasterizer.js";
import { sha256Hex } from "../src/lib/hash.js";
import {
  makeBlankImage,
  makeImageWithText,
  makeImageWithTextAndBlock,
  makePdfWithText,
  makeScannedPdf,
} from "./fixtures.js";

const app = createApp();
const OCR_TEST_TIMEOUT = 60_000;

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
  return { accessToken: res.body.accessToken as string, organizationId: res.body.organization.id as string };
}

async function registerReferenceDocument(accessToken: string, pdfBuffer: Buffer, filename: string) {
  const res = await request(app)
    .post("/documents")
    .set("Authorization", `Bearer ${accessToken}`)
    .field("documentType", "certificate")
    .field("title", "Reference Document")
    .attach("file", pdfBuffer, { filename, contentType: "application/pdf" });
  return res.body.id as string;
}

describe("PDF rasterization + OCR fallback", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it(
    "OCRs a scanned (image-only) single-page PDF and finds the rendered text",
    async () => {
      const { accessToken } = await registerOrg("Rasterization Org 1");
      const scanned = await makeScannedPdf([await makeImageWithText("PURCHASE ORDER 7734")]);

      const res = await request(app)
        .post("/verifications")
        .set("Authorization", `Bearer ${accessToken}`)
        .attach("file", scanned, { filename: "scan.pdf", contentType: "application/pdf" });

      expect(res.status).toBe(201);

      const sha256 = sha256Hex(scanned);
      const cached = await prisma.documentText.findUnique({ where: { sha256 } });
      expect(cached?.extractionMethod).toBe("OCR");
      expect(cached?.text.toUpperCase()).toContain("7734");
    },
    OCR_TEST_TIMEOUT,
  );

  it(
    "persists and caches the OCR result — resubmitting the identical file does not create a second DocumentText row",
    async () => {
      const { accessToken } = await registerOrg("Rasterization Org 2");
      const scanned = await makeScannedPdf([await makeImageWithText("RECEIPT 2201")]);
      const sha256 = sha256Hex(scanned);

      await request(app)
        .post("/verifications")
        .set("Authorization", `Bearer ${accessToken}`)
        .attach("file", scanned, { filename: "receipt1.pdf", contentType: "application/pdf" });

      await request(app)
        .post("/verifications")
        .set("Authorization", `Bearer ${accessToken}`)
        .attach("file", scanned, { filename: "receipt2.pdf", contentType: "application/pdf" });

      const count = await prisma.documentText.count({ where: { sha256 } });
      expect(count).toBe(1);
    },
    OCR_TEST_TIMEOUT,
  );

  it(
    "OCRs every page of a multi-page scanned PDF",
    async () => {
      const { accessToken } = await registerOrg("Rasterization Org 3");
      const scanned = await makeScannedPdf([
        await makeImageWithText("PAGE ONE ALPHA"),
        await makeImageWithText("PAGE TWO BRAVO"),
      ]);

      const res = await request(app)
        .post("/verifications")
        .set("Authorization", `Bearer ${accessToken}`)
        .attach("file", scanned, { filename: "multipage.pdf", contentType: "application/pdf" });

      expect(res.status).toBe(201);

      const sha256 = sha256Hex(scanned);
      const cached = await prisma.documentText.findUnique({ where: { sha256 } });
      expect(cached?.pageCount).toBe(2);
      const text = cached?.text.toUpperCase() ?? "";
      expect(text).toContain("ALPHA");
      expect(text).toContain("BRAVO");
    },
    OCR_TEST_TIMEOUT,
  );

  it(
    "classifies a blank scanned page as INCONCLUSIVE rather than a false LOW_CONCERN",
    async () => {
      const { accessToken } = await registerOrg("Rasterization Org 4");
      const scanned = await makeScannedPdf([await makeBlankImage()]);

      const res = await request(app)
        .post("/verifications")
        .set("Authorization", `Bearer ${accessToken}`)
        .attach("file", scanned, { filename: "blank.pdf", contentType: "application/pdf" });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("INCONCLUSIVE");
    },
    OCR_TEST_TIMEOUT,
  );

  it("rasterizePdfPages rejects on a truncated/malformed PDF instead of crashing the process", async () => {
    const scanned = await makeScannedPdf([await makeImageWithText("TRUNCATION TEST")]);
    const truncated = scanned.subarray(0, Math.floor(scanned.length * 0.6));

    await expect(rasterizePdfPages(truncated)).rejects.toBeTruthy();
    // extractText must also surface this as a rejection, not swallow it into
    // a false "empty but successful" result.
    await expect(extractText(truncated, "application/pdf")).rejects.toBeTruthy();
  });

  it(
    "a normal digitally-generated PDF still resolves DIRECT extraction, never invoking OCR",
    async () => {
      const { accessToken } = await registerOrg("Rasterization Org 5");
      const pdf = await makePdfWithText(["A completely ordinary digitally-generated document."]);

      const res = await request(app)
        .post("/verifications")
        .set("Authorization", `Bearer ${accessToken}`)
        .attach("file", pdf, { filename: "normal.pdf", contentType: "application/pdf" });

      expect(res.status).toBe(201);

      const sha256 = sha256Hex(pdf);
      const cached = await prisma.documentText.findUnique({ where: { sha256 } });
      expect(cached?.extractionMethod).toBe("DIRECT");
    },
    OCR_TEST_TIMEOUT,
  );

  it(
    "exact-reference short-circuit still reaches VERIFIED_MATCH without running OCR (Increment 1 regression)",
    async () => {
      const { accessToken } = await registerOrg("Rasterization Org 6");
      const scanned = await makeScannedPdf([await makeImageWithText("UNCHANGED SCAN 5510")]);
      const referenceDocumentId = await registerReferenceDocument(accessToken, scanned, "reference.pdf");

      const res = await request(app)
        .post("/verifications")
        .set("Authorization", `Bearer ${accessToken}`)
        .field("referenceDocumentId", referenceDocumentId)
        .attach("file", scanned, { filename: "copy.pdf", contentType: "application/pdf" });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("VERIFIED_MATCH");
      expect(res.body.hashMatch).toBe(true);
    },
    OCR_TEST_TIMEOUT,
  );

  it(
    "reference comparison of two scanned PDFs surfaces a rendered first-page visual difference",
    async () => {
      const { accessToken } = await registerOrg("Rasterization Org 7");
      const original = await makeScannedPdf([await makeImageWithText("ORIGINAL SCAN CONTENT")]);
      // A large added block, not just different words on a matching white
      // background — two lines of differing text mostly overlap pixel-for-
      // pixel and don't reliably cross a perceptual-diff threshold.
      const edited = await makeScannedPdf([await makeImageWithTextAndBlock("EDITED SCAN CONTENT")]);
      const referenceDocumentId = await registerReferenceDocument(accessToken, original, "orig.pdf");

      const res = await request(app)
        .post("/verifications")
        .set("Authorization", `Bearer ${accessToken}`)
        .field("referenceDocumentId", referenceDocumentId)
        .attach("file", edited, { filename: "edited.pdf", contentType: "application/pdf" });

      expect(res.status).toBe(201);

      const report = await request(app)
        .get(`/verifications/${res.body.id}/report`)
        .set("Authorization", `Bearer ${accessToken}`);
      const visualFinding = report.body.findings.REFERENCE_COMPARISON?.find(
        (f: { evidence?: { firstPageDifferencePixelRatio?: number } }) =>
          typeof f.evidence?.firstPageDifferencePixelRatio === "number",
      );
      expect(visualFinding).toBeDefined();
    },
    OCR_TEST_TIMEOUT,
  );

  it("never lets one organization read another's verification (regression)", async () => {
    const orgA = await registerOrg("Rasterization Org A");
    const orgB = await registerOrg("Rasterization Org B");
    const pdf = await makePdfWithText(["Org A only."]);

    const created = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .attach("file", pdf, { filename: "doc.pdf", contentType: "application/pdf" });

    const crossOrgRead = await request(app)
      .get(`/verifications/${created.body.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`);
    expect(crossOrgRead.status).toBe(404);
  });
});
