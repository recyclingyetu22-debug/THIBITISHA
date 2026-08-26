import { diffText, hasSignificantTextDifference } from "../textDiff.js";
import { computeVisualSignal } from "../visualSignal.js";
import { finding, type Finding } from "../finding.js";

const MODULE = "referenceComparison";
const IMAGE_DIFFERENCE_RATIO_THRESHOLD = 0.15;
const MAX_DIFF_SPANS_IN_EVIDENCE = 20;

// IMPORTANT invariant: the pixel-difference ratio (image or PDF first-page)
// is a coarse, whole-page perceptual signal, computed independently of the
// text-diff check above — never gate text-diff findings on it. A low ratio
// must NEVER be read as "content unchanged" or any form of authenticity
// evidence: a small, meaningful edit ("JOHN SMITH" → "JOHN BROWN") can move
// well under 15% of pixels on an otherwise-identical page. It exists purely
// to ADD a supplementary finding when visual appearance differs a lot, not
// to subtract risk when it doesn't. Real per-region image forensics
// (copy-move/splicing/compositing detection) is a later increment — this is
// intentionally coarse until then.
const VISUAL_SIGNAL_NOTE =
  "Coarse whole-page pixel comparison, not targeted image forensics. A low difference ratio is not evidence of authenticity — it only means this particular signal did not fire.";

export interface ReferenceComparisonInput {
  originalSha256: string;
  submittedSha256: string;
  originalText: string;
  submittedText: string;
  originalBuffer: Buffer;
  submittedBuffer: Buffer;
  originalMimeType: string;
  submittedMimeType: string;
}

export interface ReferenceComparisonResult {
  hashMatch: boolean;
  findings: Finding[];
}

// Layer 16 — optional (spec §16): only invoked when the caller supplied a
// reference. hashMatch is what lets the assessment policy reach
// VERIFIED_MATCH/MODIFIED, the two statuses the spec says require a trusted
// reference to be reachable at all.
export async function analyzeReferenceComparison(input: ReferenceComparisonInput): Promise<ReferenceComparisonResult> {
  const hashMatch = input.originalSha256 === input.submittedSha256;
  const findings: Finding[] = [];

  if (hashMatch) {
    findings.push(
      finding({
        category: "REFERENCE_COMPARISON",
        severity: "INFO",
        confidence: null,
        description: "Submitted file is byte-identical to the supplied reference document.",
        evidence: null,
        page: null,
        regions: null,
        module: MODULE,
      }),
    );
    return { hashMatch, findings };
  }

  if (hasSignificantTextDifference(input.originalText, input.submittedText)) {
    const spans = diffText(input.originalText, input.submittedText);
    findings.push(
      finding({
        category: "REFERENCE_COMPARISON",
        severity: "HIGH",
        confidence: null,
        description: `Text content differs from the supplied reference document (${spans.length} changed span${spans.length === 1 ? "" : "s"}).`,
        evidence: { changedSpans: spans.slice(0, MAX_DIFF_SPANS_IN_EVIDENCE), totalChangedSpans: spans.length },
        page: null,
        regions: null,
        module: MODULE,
      }),
    );
  } else {
    findings.push(
      finding({
        category: "REFERENCE_COMPARISON",
        severity: "INFO",
        confidence: null,
        description:
          "File bytes differ from the reference document, but extracted text content is unchanged (e.g. re-scan or re-save).",
        evidence: null,
        page: null,
        regions: null,
        module: MODULE,
      }),
    );
  }

  if (input.originalMimeType === input.submittedMimeType) {
    try {
      const visual = await computeVisualSignal(input.originalMimeType, input.originalBuffer, input.submittedBuffer);
      if (visual.kind === "image") {
        const exceedsThreshold = visual.differencePixelRatio > IMAGE_DIFFERENCE_RATIO_THRESHOLD;
        findings.push(
          finding({
            category: "REFERENCE_COMPARISON",
            severity: exceedsThreshold ? "MEDIUM" : "INFO",
            confidence: null,
            description: exceedsThreshold
              ? "Visual appearance differs meaningfully from the reference image."
              : "Visual appearance is broadly similar to the reference image (coarse signal — see note).",
            evidence: { ...visual, pagesCompared: 1, note: VISUAL_SIGNAL_NOTE },
            page: null,
            regions: null,
            module: MODULE,
          }),
        );
      } else if (visual.kind === "pdf") {
        if (!visual.pageDimensionsMatch || visual.pageCountOriginal !== visual.pageCountSubmitted) {
          findings.push(
            finding({
              category: "REFERENCE_COMPARISON",
              severity: "LOW",
              confidence: null,
              description: "Page count or dimensions differ from the reference PDF.",
              evidence: visual,
              page: null,
              regions: null,
              module: MODULE,
            }),
          );
        }
        if (visual.firstPageDifferencePixelRatio !== null) {
          const exceedsThreshold = visual.firstPageDifferencePixelRatio > IMAGE_DIFFERENCE_RATIO_THRESHOLD;
          findings.push(
            finding({
              category: "REFERENCE_COMPARISON",
              severity: exceedsThreshold ? "MEDIUM" : "INFO",
              confidence: null,
              description: exceedsThreshold
                ? "The rendered first page's visual appearance differs meaningfully from the reference PDF."
                : "The rendered first page is broadly similar to the reference PDF (coarse signal — see note).",
              evidence: { ...visual, pagesCompared: 1, note: VISUAL_SIGNAL_NOTE },
              page: 1,
              regions: null,
              module: MODULE,
            }),
          );
        }
      }
    } catch {
      // Non-fatal: the visual signal is supplementary, not the basis for
      // hashMatch/text-diff findings above (spec §66 — one sub-step failing
      // shouldn't fail the whole comparison).
    }
  }

  return { hashMatch, findings };
}
