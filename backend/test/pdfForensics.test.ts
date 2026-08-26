import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { analyzePdfStructure, countPdfRevisions } from "../src/modules/verification/analysis/pdfStructure.js";
import { makePdfWithMinorityFont, makePdfWithText } from "./fixtures.js";

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

describe("countPdfRevisions", () => {
  it("counts a single revision for a normal single-%%EOF buffer", () => {
    const buffer = Buffer.from("%PDF-1.4\n...content...\n%%EOF", "latin1");
    expect(countPdfRevisions(buffer)).toBe(1);
  });

  it("counts an appended incremental-update block as a second revision", () => {
    const original = Buffer.from("%PDF-1.4\n...content...\n%%EOF", "latin1");
    const appended = Buffer.concat([
      original,
      Buffer.from("\n1 0 obj\n<< >>\nendobj\ntrailer\n<< >>\nstartxref\n0\n%%EOF", "latin1"),
    ]);
    expect(countPdfRevisions(appended)).toBe(2);
  });

  it("does not count %%EOF-like bytes without line anchoring", () => {
    const buffer = Buffer.from("%PDF-1.4\nsome binary garbage containing x%%EOFy inline\n%%EOF", "latin1");
    // Only the properly line-anchored occurrence at the end should count.
    expect(countPdfRevisions(buffer)).toBe(1);
  });
});

describe("PDF structural forensics", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("does not flag a genuine, single-font, single-revision PDF beyond the baseline metadata finding", async () => {
    const pdf = await makePdfWithText([
      "This is a routine contract between two parties.",
      "The first party agrees to the following terms.",
      "The second party accepts these terms in full.",
      "Both parties sign below to indicate agreement.",
      "This document is effective as of the date signed.",
      "No further amendments apply unless noted separately.",
    ]);

    const result = await analyzePdfStructure(pdf);
    expect(result.readable).toBe(true);

    const concerning = result.findings.filter((f) => f.severity === "MEDIUM" || f.severity === "HIGH");
    expect(concerning).toEqual([]);
  });

  it("flags a minority font used in only one span among many in a dominant font", async () => {
    // Enough body lines that the minority text — which pdfkit/pdfjs can
    // split into several word-level items depending on punctuation/kerning
    // — still lands well under the minority-share threshold either way.
    const bodyLines = Array.from(
      { length: 20 },
      (_, i) => `Invoice line item ${i + 1}: service rendered and accepted in full.`,
    );
    const pdf = await makePdfWithMinorityFont(bodyLines, "TOTAL DUE: 9999.00 USD");

    const result = await analyzePdfStructure(pdf);
    const fontFinding = result.findings.find((f) => f.description.includes("differs from the font used"));
    expect(fontFinding).toBeDefined();
    expect(fontFinding?.severity).toBe("MEDIUM");
    const evidence = fontFinding?.evidence as { dominantFont: string; minorityFonts: Array<{ fontName: string }> };
    // pdfjs resolves to generic CSS font-family categories, not exact PDF
    // font names, since rendering is disabled (we never rasterize with
    // pdfjs) — Helvetica → "sans-serif", Courier → "monospace". Still a
    // real, human-meaningful distinction; assert on that distinction rather
    // than a specific string pdfjs's internal classifier happens to produce.
    expect(evidence.dominantFont).not.toBe("");
    expect(evidence.minorityFonts.every((f) => f.fontName !== evidence.dominantFont)).toBe(true);
    expect(evidence.minorityFonts.some((f) => /monospace/i.test(f.fontName))).toBe(true);
  });

  it("flags structural revision evidence with no matching ModDate in metadata", async () => {
    const pdf = await makePdfWithText(["A simple document with no modification history claimed in its metadata."]);
    // Simulate an appended incremental update on the raw bytes — exercises
    // the cross-check without needing a fully-valid multi-revision PDF
    // writer, which nothing in our toolchain produces.
    const withAppendedRevision = Buffer.concat([
      pdf,
      Buffer.from("\n1 0 obj\n<< >>\nendobj\ntrailer\n<< >>\nstartxref\n0\n%%EOF", "latin1"),
    ]);

    const result = await analyzePdfStructure(withAppendedRevision);
    expect(result.readable).toBe(true);

    const crossCheck = result.findings.find((f) =>
      f.description.toLowerCase().includes("does not record a modification date"),
    );
    expect(crossCheck).toBeDefined();
    expect(crossCheck?.severity).toBe("MEDIUM");
  });

  it("surfaces a font-anomaly finding through the full HTTP report, correctly categorized", async () => {
    const accessToken = await registerOrg("Forensics Org 1");
    const bodyLines = Array.from(
      { length: 20 },
      (_, i) => `Certificate line ${i + 1}: recognized for sustained excellence.`,
    );
    const pdf = await makePdfWithMinorityFont(bodyLines, "AMOUNT: 5000.00");

    const res = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", pdf, { filename: "certificate.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(201);

    const report = await request(app)
      .get(`/verifications/${res.body.id}/report`)
      .set("Authorization", `Bearer ${accessToken}`);

    const structureFindings = report.body.findings.PDF_STRUCTURE ?? [];
    const fontFinding = structureFindings.find((f: { description: string }) =>
      f.description.includes("differs from the font used"),
    );
    expect(fontFinding).toBeDefined();
  });
});
