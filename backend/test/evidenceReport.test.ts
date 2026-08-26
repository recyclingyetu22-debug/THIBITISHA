import { describe, expect, it } from "vitest";
import { buildEvidenceReport, type EvidenceReportFindingInput, type EvidenceReportInput } from "../src/modules/verification/evidenceReport.js";
import type { ModuleCoverageEntry } from "../src/modules/verification/orchestrator.js";

const FULL_MODULE_COVERAGE: ModuleCoverageEntry[] = [
  { module: "fileIntegrity", status: "ran" },
  { module: "pdfStructure", status: "ran" },
  { module: "typography", status: "ran" },
  { module: "imageSignal", status: "skipped", reason: "not applicable to a PDF" },
  { module: "imageForensics", status: "skipped", reason: "not applicable to PDF-embedded content this increment" },
  { module: "regionForensics", status: "ran" },
  { module: "textExtraction", status: "ran" },
  { module: "textConsistency", status: "ran" },
  { module: "aiIndicators", status: "ran" },
  { module: "referenceComparison", status: "skipped", reason: "no reference document supplied" },
];

function baseInput(overrides: Partial<EvidenceReportInput> = {}): EvidenceReportInput {
  return {
    id: "req-1",
    originalFilename: "document.pdf",
    mimeType: "application/pdf",
    sha256: "abc123",
    sizeBytes: 1024,
    createdAt: new Date("2026-08-24T00:00:00Z"),
    submittedByName: "Test Submitter",
    pageCount: 1,
    analyzedPageCount: 1,
    coverageIncomplete: false,
    moduleCoverage: FULL_MODULE_COVERAGE,
    referenceDocument: null,
    assessment: { status: "LOW_CONCERN", summary: "No significant manipulation indicators were detected.", recommendation: "This analysis does not independently verify the document's authenticity. If certainty is required, contact the claimed issuer directly." },
    findings: [],
    issuerConfirmationEvents: [],
    ...overrides,
  };
}

function finding(overrides: Partial<EvidenceReportFindingInput> = {}): EvidenceReportFindingInput {
  return {
    category: "PDF_STRUCTURE",
    severity: "MEDIUM",
    confidence: null,
    description: "test finding",
    evidence: null,
    page: 1,
    regions: null,
    module: "pdfStructure",
    ...overrides,
  };
}

describe("evidenceReport: six-section structure", () => {
  it("returns findings, overallAssessment, coverage, limitations, recommendation, referenceComparison, and issuerConfirmation as distinct sections", () => {
    const report = buildEvidenceReport(baseInput());

    expect(report.findings).toBeDefined();
    expect(report.overallAssessment).toEqual({ status: "LOW_CONCERN", summary: "No significant manipulation indicators were detected." });
    expect(report.coverage.pages).toEqual({ pageCount: 1, analyzedPageCount: 1, complete: true });
    expect(report.coverage.modules).toEqual(FULL_MODULE_COVERAGE);
    expect(Array.isArray(report.limitations)).toBe(true);
    expect(report.recommendation).toBe(baseInput().assessment!.recommendation);
    expect(report.referenceComparison).toEqual({ available: false, documentId: null, documentNumber: null });
    expect(report.issuerConfirmation).toEqual({ status: "NOT_REQUESTED", history: [] });
  });

  it("recommendation is its own top-level key, distinct from overallAssessment", () => {
    const report = buildEvidenceReport(baseInput());
    expect(report.overallAssessment).not.toHaveProperty("recommendation");
    expect(typeof report.recommendation).toBe("string");
  });
});

describe("evidenceReport: coverage and limitations", () => {
  it("surfaces incomplete page coverage in limitations with the right language", () => {
    const report = buildEvidenceReport(baseInput({ coverageIncomplete: true, pageCount: 10, analyzedPageCount: 3 }));
    expect(report.limitations.some((l) => l.includes("3 of 10 pages"))).toBe(true);
  });

  it("surfaces a skipped/failed module in limitations", () => {
    const report = buildEvidenceReport(baseInput());
    expect(report.limitations.some((l) => l.includes("Image metadata analysis") && l.includes("not applicable to a PDF"))).toBe(true);
    expect(report.limitations.some((l) => l.includes("Reference document comparison"))).toBe(true);
  });

  it("does not list a module that ran as a limitation", () => {
    const report = buildEvidenceReport(baseInput());
    expect(report.limitations.some((l) => l.startsWith("File integrity check"))).toBe(false);
  });

  it("notes when region forensics used its coarse grid fallback", () => {
    const report = buildEvidenceReport(
      baseInput({
        findings: [finding({ category: "REGION_FORENSICS", module: "regionForensics:boundary", evidence: { regionSource: "grid-cell" } })],
      }),
    );
    expect(report.limitations.some((l) => l.toLowerCase().includes("grid fallback"))).toBe(true);
  });
});

describe("evidenceReport: standalone verification (no reference)", () => {
  it("uses 'no significant manipulation indicators' language, never 'authentic'/'genuine'", () => {
    const report = buildEvidenceReport(baseInput());
    expect(report.referenceComparison.available).toBe(false);
    expect(report.executiveSummary.toLowerCase()).not.toContain("authentic");
    expect(report.executiveSummary.toLowerCase()).not.toContain("genuine");
    expect(report.executiveSummary).toContain("No significant manipulation indicators were detected.");
    expect(report.executiveSummary).toContain("No reference document was supplied for comparison.");
    expect(report.executiveSummary).toContain("No independent confirmation from the claimed issuing organization was sought");
  });
});

describe("evidenceReport: reference-confirmed match", () => {
  it("reports VERIFIED_MATCH and referenceComparison.available = true", () => {
    const report = buildEvidenceReport(
      baseInput({
        referenceDocument: { id: "doc-1", documentNumber: "DOC-2026-00000001" },
        assessment: {
          status: "VERIFIED_MATCH",
          summary: "The submitted document is byte-identical to the supplied reference document.",
          recommendation: "This confirms the submission matches the reference exactly.",
        },
      }),
    );

    expect(report.overallAssessment?.status).toBe("VERIFIED_MATCH");
    expect(report.referenceComparison).toEqual({ available: true, documentId: "doc-1", documentNumber: "DOC-2026-00000001" });
    expect(report.executiveSummary).toContain("A reference document was supplied");
  });
});

describe("evidenceReport: correlated findings integration", () => {
  it("includes correlatedFindings computed from the report's own findings", () => {
    const overlapping = { x: 10, y: 10, width: 50, height: 50 };
    const report = buildEvidenceReport(
      baseInput({
        findings: [
          finding({ module: "typography", category: "TYPOGRAPHY", regions: [overlapping] }),
          finding({ module: "regionForensics:boundary", category: "REGION_FORENSICS", regions: [overlapping] }),
        ],
      }),
    );

    expect(report.correlatedFindings).toHaveLength(1);
    expect(report.correlatedFindings[0].corroborated).toBe(true);
  });

  // Regression: found via manual smoke testing — two purely-INFO findings
  // (e.g. baseline "here is the PDF's metadata" + "AI analysis found
  // nothing") both happen to have page: null and were being reported as a
  // "corroborated" cluster purely because they shared the absence of a
  // page, not because independent detectors agreed on anything noteworthy.
  it("does not treat two INFO-severity findings sharing no page as corroborating evidence", () => {
    const report = buildEvidenceReport(
      baseInput({
        findings: [
          finding({ module: "pdfStructure", category: "PDF_STRUCTURE", severity: "INFO", page: null, regions: null }),
          finding({ module: "aiIndicators:heuristic", category: "AI_INDICATOR", severity: "INFO", page: null, regions: null }),
        ],
      }),
    );

    expect(report.correlatedFindings).toHaveLength(0);
    // Both findings are still fully present in the findings section itself.
    expect(report.findings.PDF_STRUCTURE).toHaveLength(1);
    expect(report.findings.AI_INDICATOR).toHaveLength(1);
  });
});

describe("evidenceReport: assessmentConfidence", () => {
  it("is HIGH when coverage is complete and nothing failed", () => {
    const report = buildEvidenceReport(baseInput());
    expect(report.assessmentConfidence).toBe("HIGH");
  });

  it("is LOW when a module failed", () => {
    const coverageWithFailure = FULL_MODULE_COVERAGE.map((m) =>
      m.module === "pdfStructure" ? { module: m.module, status: "failed" as const, reason: "PDF could not be parsed" } : m,
    );
    const report = buildEvidenceReport(baseInput({ moduleCoverage: coverageWithFailure }));
    expect(report.assessmentConfidence).toBe("LOW");
  });

  it("is LOW when page coverage is incomplete", () => {
    const report = buildEvidenceReport(baseInput({ coverageIncomplete: true, pageCount: 10, analyzedPageCount: 2 }));
    expect(report.assessmentConfidence).toBe("LOW");
  });

  it("is unaffected by a module that was merely skipped as not applicable", () => {
    // FULL_MODULE_COVERAGE already includes imageSignal/imageForensics
    // skipped as "not applicable to a PDF" — confirms these alone don't
    // drag confidence down (that's the whole point of the not-applicable
    // exclusion, distinct from a substantive gap like "no reference
    // supplied").
    const report = buildEvidenceReport(baseInput());
    expect(report.assessmentConfidence).not.toBe("LOW");
  });

  it("is not lowered by 'no reference document supplied' — that's the normal standalone-verification case, not a gap", () => {
    // FULL_MODULE_COVERAGE's referenceComparison entry is skipped for
    // exactly this reason; confirms it alone doesn't drag confidence down,
    // since reference comparison is optional by design.
    const report = buildEvidenceReport(baseInput());
    expect(report.assessmentConfidence).toBe("HIGH");
  });

  it("is MEDIUM when a module was skipped for a genuinely substantive reason (e.g. no extractable text)", () => {
    const coverageWithGap = FULL_MODULE_COVERAGE.map((m) =>
      m.module === "textConsistency" ? { module: m.module, status: "skipped" as const, reason: "no extractable text" } : m,
    );
    const report = buildEvidenceReport(baseInput({ moduleCoverage: coverageWithGap }));
    expect(report.assessmentConfidence).toBe("MEDIUM");
  });
});

describe("evidenceReport: keyFindings and affectedPages", () => {
  it("keyFindings excludes INFO severity and sorts HIGH before MEDIUM before LOW", () => {
    const report = buildEvidenceReport(
      baseInput({
        findings: [
          finding({ severity: "INFO", description: "info finding", page: 1 }),
          finding({ severity: "LOW", description: "low finding", page: 1 }),
          finding({ severity: "HIGH", description: "high finding", page: 2 }),
          finding({ severity: "MEDIUM", description: "medium finding", page: 3 }),
        ],
      }),
    );

    expect(report.keyFindings.map((f) => f.severity)).toEqual(["HIGH", "MEDIUM", "LOW"]);
  });

  it("keyFindings caps at 5 entries", () => {
    const manyFindings = Array.from({ length: 8 }, (_, i) => finding({ severity: "HIGH", description: `finding ${i}` }));
    const report = buildEvidenceReport(baseInput({ findings: manyFindings }));
    expect(report.keyFindings).toHaveLength(5);
  });

  it("affectedPages lists distinct pages with non-INFO findings, sorted, excluding INFO-only pages", () => {
    const report = buildEvidenceReport(
      baseInput({
        findings: [
          finding({ severity: "INFO", page: 1 }),
          finding({ severity: "MEDIUM", page: 3 }),
          finding({ severity: "HIGH", page: 2 }),
          finding({ severity: "MEDIUM", page: 2 }), // duplicate page, should not duplicate in output
        ],
      }),
    );

    expect(report.affectedPages).toEqual([2, 3]);
  });
});
