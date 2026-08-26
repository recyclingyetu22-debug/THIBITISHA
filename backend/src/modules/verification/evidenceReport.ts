import type { FindingCategory, FindingSeverity, IssuerConfirmationStatus, VerificationAssessmentStatus } from "@prisma/client";
import { correlateFindings, type CorrelatableFinding, type CorrelationCluster } from "./correlation.js";
import type { ModuleCoverageEntry } from "./orchestrator.js";
import type { PixelRect } from "./finding.js";
import { deriveCurrentStatus, type IssuerConfirmationEventView } from "./issuerConfirmation.js";

// Structural shape, not tied to Prisma's generated type — this is what lets
// evidenceReport.test.ts build plain object literals instead of needing a
// real DB round-trip for every case (see the Increment plan).
export interface EvidenceReportFindingInput {
  category: FindingCategory;
  severity: FindingSeverity;
  confidence: number | null;
  description: string;
  evidence: unknown;
  page: number | null;
  regions: unknown;
  module: string;
}

export interface EvidenceReportInput {
  id: string;
  originalFilename: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
  createdAt: Date;
  submittedByName: string;
  pageCount: number | null;
  analyzedPageCount: number | null;
  coverageIncomplete: boolean;
  moduleCoverage: unknown;
  referenceDocument: { id: string; documentNumber: string } | null;
  assessment: { status: VerificationAssessmentStatus; summary: string; recommendation: string } | null;
  findings: EvidenceReportFindingInput[];
  issuerConfirmationEvents: IssuerConfirmationEventView[];
}

export interface FindingView {
  severity: FindingSeverity;
  confidence: number | null;
  description: string;
  evidence: unknown;
  page: number | null;
  regions: PixelRect[] | null;
  module: string;
}

export type AssessmentConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface EvidenceReport {
  document: { filename: string; mimeType: string; sha256: string; sizeBytes: number; analyzedAt: Date; submittedByName: string };
  executiveSummary: string;
  // Forensic assessment — what THIBITISHA's detectors found. Kept
  // strictly separate from referenceComparison and issuerConfirmation below
  // (spec: these are three different kinds of evidence, never conflated).
  overallAssessment: { status: VerificationAssessmentStatus; summary: string } | null;
  assessmentConfidence: AssessmentConfidence;
  keyFindings: FindingView[];
  findings: Record<string, FindingView[]>;
  correlatedFindings: CorrelationCluster[];
  affectedPages: number[];
  coverage: { pages: { pageCount: number | null; analyzedPageCount: number | null; complete: boolean }; modules: ModuleCoverageEntry[] };
  limitations: string[];
  recommendation: string | null;
  // Reference comparison — comparison against a caller-supplied known
  // document. Distinct from issuerConfirmation: no document bytes are
  // exchanged with the issuer, and this is computed by a detector, not
  // recorded from a manual contact.
  referenceComparison: { available: boolean; documentId: string | null; documentNumber: string | null };
  // Issuer confirmation — independent, out-of-band confirmation from the
  // document's claimed issuing organization. Never fed back into
  // overallAssessment; a human weighs both fields side by side.
  issuerConfirmation: { status: IssuerConfirmationStatus | "NOT_REQUESTED"; history: IssuerConfirmationEventView[] };
}

const MODULE_DISPLAY_NAMES: Record<string, string> = {
  fileIntegrity: "File integrity check",
  pdfStructure: "PDF structure analysis",
  typography: "Typography/layout analysis",
  imageSignal: "Image metadata analysis",
  imageForensics: "Image pixel forensics (compression/copy-move analysis)",
  regionForensics: "Region forensics (signature/seal/logo/photo area analysis)",
  textExtraction: "Text extraction / OCR",
  textConsistency: "Text consistency analysis",
  aiIndicators: "AI-generation indicator analysis",
  referenceComparison: "Reference document comparison",
};

const SEVERITY_RANK: Record<FindingSeverity, number> = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
const KEY_FINDINGS_LIMIT = 5;

function displayName(module: string): string {
  return MODULE_DISPLAY_NAMES[module] ?? module;
}

function asRegions(value: unknown): PixelRect[] | null {
  return Array.isArray(value) ? (value as PixelRect[]) : null;
}

function asModuleCoverage(value: unknown): ModuleCoverageEntry[] {
  return Array.isArray(value) ? (value as ModuleCoverageEntry[]) : [];
}

function buildLimitations(input: EvidenceReportInput, moduleCoverage: ModuleCoverageEntry[]): string[] {
  const limitations: string[] = [];

  if (input.coverageIncomplete) {
    limitations.push(
      `Only ${input.analyzedPageCount ?? 0} of ${input.pageCount ?? 0} pages could be analyzed — this is a partial result, not a complete review of the document.`,
    );
  }

  for (const entry of moduleCoverage) {
    if (entry.status === "skipped" || entry.status === "failed") {
      const verb = entry.status === "failed" ? "failed" : "was skipped";
      limitations.push(`${displayName(entry.module)} ${verb}${entry.reason ? `: ${entry.reason}` : "."}`);
    }
  }

  const usedGridFallback = input.findings.some((f) => {
    const evidence = f.evidence as { regionSource?: string } | null;
    return evidence?.regionSource === "grid-cell";
  });
  if (usedGridFallback) {
    limitations.push(
      "Region localization used a coarse grid fallback rather than precise detection for at least part of this document — see the Increment 6 plan's named limitation on grid-aligned coverage.",
    );
  }

  const aiNoDetermination = input.findings.some(
    (f) => f.category === "AI_INDICATOR" && f.description.includes("could not reach a determination"),
  );
  if (aiNoDetermination) {
    limitations.push(
      "AI-generation/editing analysis used heuristic metadata checks only and could not reach a determination for this document.",
    );
  }

  return limitations;
}

// Deliberately not a fake precision percentage, and deliberately separate
// from each finding's own `confidence` float — this answers "how much
// should you trust this read of the evidence" (a coverage/reliability
// question), not "how likely is any given finding to be a true positive"
// (spec: never combine confidence and risk into one number).
function computeAssessmentConfidence(input: EvidenceReportInput, moduleCoverage: ModuleCoverageEntry[]): AssessmentConfidence {
  const anyFailed = moduleCoverage.some((m) => m.status === "failed");
  if (input.coverageIncomplete || anyFailed || input.assessment?.status === "INCONCLUSIVE") {
    return "LOW";
  }

  // Two kinds of "skipped" don't reflect a gap in what could be learned
  // about *this document*: not applicable to the file type, and "no
  // reference document supplied" — reference comparison is optional by
  // design (the whole point of the standalone-verification pivot), not a
  // limitation of this analysis. A skip for any other substantive reason
  // (e.g. no extractable text — an actual quality/readability problem with
  // this specific document) means real evidence that could exist isn't
  // available here, which does lower confidence in the read.
  const hasSubstantiveGap = moduleCoverage.some(
    (m) =>
      m.status === "skipped" &&
      m.reason &&
      !/not applicable/i.test(m.reason) &&
      !/no reference document supplied/i.test(m.reason),
  );
  return hasSubstantiveGap ? "MEDIUM" : "HIGH";
}

function buildKeyFindings(findingViews: FindingView[]): FindingView[] {
  return [...findingViews]
    .filter((f) => f.severity !== "INFO")
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .slice(0, KEY_FINDINGS_LIMIT);
}

function buildAffectedPages(findingViews: FindingView[]): number[] {
  const pages = new Set<number>();
  for (const f of findingViews) {
    if (f.severity !== "INFO" && f.page !== null) pages.add(f.page);
  }
  return [...pages].sort((a, b) => a - b);
}

function buildExecutiveSummary(
  input: EvidenceReportInput,
  moduleCoverage: ModuleCoverageEntry[],
  correlated: CorrelationCluster[],
  referenceAvailable: boolean,
  issuerStatus: IssuerConfirmationStatus | "NOT_REQUESTED",
): string {
  const sentences: string[] = [];

  // Reuse assessment.ts's already-vetted language verbatim — this is the
  // guardrail against the report layer inventing new phrasing that could
  // drift from the "no significant indicators ≠ authentic" discipline the
  // assessment policy enforces (spec: never say "authentic"/"genuine" for a
  // standalone result).
  sentences.push(input.assessment?.summary ?? "This document could not be reliably analyzed.");

  const ranCount = moduleCoverage.filter((m) => m.status === "ran").length;
  const findingCount = input.findings.length;
  sentences.push(
    `This document was analyzed by ${ranCount} independent forensic check${ranCount === 1 ? "" : "s"}, producing ${findingCount} finding${findingCount === 1 ? "" : "s"}.`,
  );

  const corroborated = correlated.filter((c) => c.corroborated);
  if (corroborated.length > 0) {
    sentences.push(
      `${corroborated.length} area${corroborated.length === 1 ? "" : "s"} of the document ${corroborated.length === 1 ? "was" : "were"} independently flagged by more than one detector, which strengthens that evidence.`,
    );
  }

  if (input.coverageIncomplete) {
    sentences.push("Not every page of this document could be analyzed — see limitations for details.");
  }

  sentences.push(
    referenceAvailable
      ? "A reference document was supplied by the organization and used for comparison."
      : "No reference document was supplied for comparison.",
  );

  // Only mentioned when it's actually happened — most verifications never
  // go through issuer confirmation, and the common case's summary should
  // stay clean rather than always noting an inapplicable field.
  if (issuerStatus !== "NOT_REQUESTED") {
    sentences.push(`Issuer confirmation status: ${issuerStatus.replace(/_/g, " ").toLowerCase()}.`);
  } else {
    sentences.push("No independent confirmation from the claimed issuing organization was sought for this analysis.");
  }

  return sentences.join(" ");
}

export function buildEvidenceReport(input: EvidenceReportInput): EvidenceReport {
  const moduleCoverage = asModuleCoverage(input.moduleCoverage);
  const referenceAvailable = input.referenceDocument !== null;

  const findingViews: FindingView[] = input.findings.map((f) => ({
    severity: f.severity,
    confidence: f.confidence,
    description: f.description,
    evidence: f.evidence,
    page: f.page,
    regions: asRegions(f.regions),
    module: f.module,
  }));

  const grouped: Record<string, FindingView[]> = {};
  for (let i = 0; i < input.findings.length; i++) {
    const category = input.findings[i].category;
    (grouped[category] ??= []).push(findingViews[i]);
  }

  // INFO-severity findings are baseline/informational (e.g. "here is the
  // PDF's metadata," "AI analysis reached no determination") — excluded
  // from correlation so two routine findings sharing "no page" don't get
  // reported as detectors "corroborating" each other. Corroboration should
  // mean independent detectors agreeing on something noteworthy, not an
  // artifact of both lacking page-specificity. Still fully present in the
  // `findings` section either way — only excluded from this clustering.
  const correlatable: CorrelatableFinding[] = input.findings
    .filter((f) => f.severity !== "INFO")
    .map((f) => ({
      module: f.module,
      category: f.category,
      severity: f.severity,
      description: f.description,
      page: f.page,
      regions: asRegions(f.regions),
    }));
  const correlatedFindings = correlateFindings(correlatable);

  const issuerStatus = deriveCurrentStatus(input.issuerConfirmationEvents);
  const limitations = buildLimitations(input, moduleCoverage);
  const executiveSummary = buildExecutiveSummary(input, moduleCoverage, correlatedFindings, referenceAvailable, issuerStatus);

  return {
    document: {
      filename: input.originalFilename,
      mimeType: input.mimeType,
      sha256: input.sha256,
      sizeBytes: input.sizeBytes,
      analyzedAt: input.createdAt,
      submittedByName: input.submittedByName,
    },
    executiveSummary,
    overallAssessment: input.assessment ? { status: input.assessment.status, summary: input.assessment.summary } : null,
    assessmentConfidence: computeAssessmentConfidence(input, moduleCoverage),
    keyFindings: buildKeyFindings(findingViews),
    findings: grouped,
    correlatedFindings,
    affectedPages: buildAffectedPages(findingViews),
    coverage: {
      pages: { pageCount: input.pageCount, analyzedPageCount: input.analyzedPageCount, complete: !input.coverageIncomplete },
      modules: moduleCoverage,
    },
    limitations,
    recommendation: input.assessment?.recommendation ?? null,
    referenceComparison: {
      available: referenceAvailable,
      documentId: input.referenceDocument?.id ?? null,
      documentNumber: input.referenceDocument?.documentNumber ?? null,
    },
    issuerConfirmation: { status: issuerStatus, history: input.issuerConfirmationEvents },
  };
}
