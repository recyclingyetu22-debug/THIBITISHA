// Plain-language layer for forensic findings, scoped deliberately at the
// FindingCategory level — a closed set of 8 values — rather than trying to
// rewrite the open-ended, detector-authored `description` string on every
// finding. This is the Executive view's primary text; the raw
// description/module/evidence/confidence stay available as "Technical
// details" for the Forensic view. Never use words like "fake"/"forged" —
// stay in the same register as the backend's own findings ("indicator",
// "inconsistency", "differs from expected").
import type { FindingCategory, FindingView } from "./api/types.js";

export interface CategoryExplanation {
  title: string;
  description: string;
}

export const CATEGORY_EXPLANATIONS: Record<FindingCategory, CategoryExplanation> = {
  FILE_INTEGRITY: {
    title: "File integrity check",
    description: "Checks whether the file itself is well-formed and hasn't been corrupted or altered at the byte level.",
  },
  PDF_STRUCTURE: {
    title: "Document structure",
    description: "Checks the document's internal structure — its pages, fonts, and embedded objects — for unusual edits or software fingerprints.",
  },
  TEXT_CONSISTENCY: {
    title: "Text consistency",
    description: "Checks whether the text throughout the document is consistent with a single, unedited document — for example, matching fonts, spacing, and formatting.",
  },
  TYPOGRAPHY: {
    title: "Typography & layout",
    description: "Checks whether fonts, sizes, and layout are consistent across the document. Inconsistent typography can indicate a section was added or changed later.",
  },
  IMAGE_SIGNAL: {
    title: "Image metadata",
    description: "Checks metadata attached to images in the document — like the software that created or last touched them — for signs of editing.",
  },
  REGION_FORENSICS: {
    title: "Image manipulation indicator",
    description: "Checks specific areas of the document — such as signatures, seals, logos, or photos — for signs that the pixels in that area were copied, pasted, or otherwise altered.",
  },
  AI_INDICATOR: {
    title: "AI-generation indicator",
    description: "Checks for signals that part of the document may have been created or altered using AI tools.",
  },
  REFERENCE_COMPARISON: {
    title: "Reference comparison",
    description: "Directly compares this document against a known original your organization supplied, rather than judging it on its own.",
  },
};

export interface ExplainedFindingCopy {
  title: string;
  what: string;
  where: string;
}

// Category comes from the caller (findings arrive grouped by category —
// `EvidenceReport.findings: Record<FindingCategory, FindingView[]>` — a
// FindingView itself doesn't carry its own category back).
export function explainFinding(finding: FindingView, category: FindingCategory): ExplainedFindingCopy {
  const categoryCopy = CATEGORY_EXPLANATIONS[category];
  const where =
    finding.page !== null
      ? `Page ${finding.page}${finding.regions && finding.regions.length > 0 ? ", highlighted area" : ""}`
      : "Not tied to a specific page";

  return {
    title: categoryCopy.title,
    what: categoryCopy.description,
    where,
  };
}
