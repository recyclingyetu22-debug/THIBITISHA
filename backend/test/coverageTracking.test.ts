import { describe, expect, it } from "vitest";
import { rasterizePdfPages } from "../src/modules/verification/pdfRasterizer.js";
import { extractText } from "../src/modules/verification/textExtraction.js";
import { RuleBasedAssessmentPolicy, type AssessmentContext } from "../src/modules/verification/assessment.js";
import type { Finding } from "../src/modules/verification/finding.js";
import { makeImageWithText, makeScannedPdf } from "./fixtures.js";

const OCR_TEST_TIMEOUT = 60_000;

function baseContext(overrides: Partial<AssessmentContext>): AssessmentContext {
  return {
    findings: [],
    hasReference: false,
    hashMatch: null,
    extractionFailed: false,
    coverageIncomplete: false,
    ...overrides,
  };
}

function mediumFinding(): Finding {
  return {
    category: "TEXT_CONSISTENCY",
    severity: "MEDIUM",
    confidence: null,
    description: "test finding",
    evidence: null,
    page: null,
    module: "test",
  };
}

function highFinding(): Finding {
  return {
    category: "PDF_STRUCTURE",
    severity: "HIGH",
    confidence: null,
    description: "test high finding",
    evidence: null,
    page: null,
    module: "test",
  };
}

describe("rasterizePdfPages honors a page cap and reports incomplete coverage", () => {
  it(
    "processes only maxPages pages and reports the true total, never silently discarding the rest",
    async () => {
      const scanned = await makeScannedPdf([
        await makeImageWithText("PAGE ONE"),
        await makeImageWithText("PAGE TWO"),
        await makeImageWithText("PAGE THREE"),
        await makeImageWithText("PAGE FOUR"),
      ]);

      const result = await rasterizePdfPages(scanned, 2);

      expect(result.totalPageCount).toBe(4);
      expect(result.analyzedPageCount).toBe(2);
      expect(result.pageImages).toHaveLength(2);
      expect(result.coverageIncomplete).toBe(true);
    },
    OCR_TEST_TIMEOUT,
  );

  it(
    "reports complete coverage when the document is within the page cap",
    async () => {
      const scanned = await makeScannedPdf([await makeImageWithText("ONLY PAGE")]);
      const result = await rasterizePdfPages(scanned, 50);

      expect(result.totalPageCount).toBe(1);
      expect(result.analyzedPageCount).toBe(1);
      expect(result.coverageIncomplete).toBe(false);
    },
    OCR_TEST_TIMEOUT,
  );

  it(
    "extractText surfaces the true total page count and analyzedPageCount together, not pageImages.length as a stand-in for the total",
    async () => {
      const scanned = await makeScannedPdf([
        await makeImageWithText("A"),
        await makeImageWithText("B"),
        await makeImageWithText("C"),
      ]);

      const extracted = await extractText(scanned, "application/pdf", 1);
      expect(extracted.pageCount).toBe(3);
      expect(extracted.analyzedPageCount).toBe(1);
    },
    OCR_TEST_TIMEOUT,
  );
});

describe("RuleBasedAssessmentPolicy never presents incomplete coverage as a clean result", () => {
  it("escalates what would be LOW_CONCERN to INCONCLUSIVE when coverage is incomplete", () => {
    const policy = new RuleBasedAssessmentPolicy();
    const outcome = policy.assess(baseContext({ findings: [], coverageIncomplete: true }));

    expect(outcome.status).toBe("INCONCLUSIVE");
    expect(outcome.recommendation.toLowerCase()).toContain("not every page");
  });

  it("does not suppress a genuine HIGH_RISK finding just because coverage was incomplete", () => {
    const policy = new RuleBasedAssessmentPolicy();
    const outcome = policy.assess(baseContext({ findings: [highFinding()], coverageIncomplete: true }));

    expect(outcome.status).toBe("HIGH_RISK");
    expect(outcome.recommendation.toLowerCase()).toContain("not every page");
  });

  it("does not suppress SUSPICIOUS either, but appends the coverage caveat", () => {
    const policy = new RuleBasedAssessmentPolicy();
    const outcome = policy.assess(baseContext({ findings: [mediumFinding()], coverageIncomplete: true }));

    expect(outcome.status).toBe("SUSPICIOUS");
    expect(outcome.recommendation.toLowerCase()).toContain("not every page");
  });

  it("with a reference: escalates the 'no meaningful difference found' LOW_CONCERN to INCONCLUSIVE under incomplete coverage", () => {
    const policy = new RuleBasedAssessmentPolicy();
    const outcome = policy.assess(
      baseContext({ hasReference: true, hashMatch: false, findings: [], coverageIncomplete: true }),
    );

    expect(outcome.status).toBe("INCONCLUSIVE");
  });

  it("full coverage still resolves to LOW_CONCERN when nothing was found (regression)", () => {
    const policy = new RuleBasedAssessmentPolicy();
    const outcome = policy.assess(baseContext({ findings: [], coverageIncomplete: false }));

    expect(outcome.status).toBe("LOW_CONCERN");
  });
});
