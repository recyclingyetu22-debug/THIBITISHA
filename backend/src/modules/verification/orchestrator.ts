import type { TextExtractionMethod } from "@prisma/client";
import type { DetectedFileType } from "../../lib/fileType.js";
import { analyzeFileIntegrity, UnsupportedFileError } from "./analysis/fileIntegrity.js";
import { analyzePdfStructure } from "./analysis/pdfStructure.js";
import { analyzeTypography } from "./analysis/typography.js";
import { analyzeImageSignal } from "./analysis/imageSignal.js";
import { analyzeImageForensics } from "./analysis/imageForensics.js";
import { analyzeImageRegionForensics, analyzePdfRegionForensics } from "./analysis/regionForensics.js";
import { getOrExtractText } from "./textExtraction.js";
import { analyzeTextConsistency } from "./analysis/textConsistency.js";
import { analyzeAiIndicators, type AIAnalysisProvider } from "./analysis/aiIndicators.js";
import { analyzeReferenceComparison } from "./analysis/referenceComparison.js";
import { finding, type Finding } from "./finding.js";

export { UnsupportedFileError };

export interface ReferenceInput {
  buffer: Buffer;
  mimeType: string;
  sha256: string;
  text: string;
}

export interface OrchestratorInput {
  buffer: Buffer;
  sha256: string;
  declaredMimeType: string;
  filename: string;
  reference: ReferenceInput | null;
  aiProvider: AIAnalysisProvider;
}

// One entry per detector — what evidenceReport.ts's "coverage"/"limitations"
// sections are built from. Persisted (verification.service.ts), not
// recomputed later: a module that ran and found nothing is otherwise
// indistinguishable, after the fact, from one that never ran at all.
export interface ModuleCoverageEntry {
  module: string;
  status: "ran" | "skipped" | "failed";
  reason?: string;
}

export interface OrchestratorOutput {
  detectedType: DetectedFileType;
  pageCount: number | null;
  analyzedPageCount: number | null;
  extractedText: string | null;
  extractionMethod: TextExtractionMethod | null;
  findings: Finding[];
  hashMatch: boolean | null;
  extractionFailed: boolean;
  // True whenever the document has more pages than were actually analyzed
  // (today: the OCR-rasterization cap). The assessment policy MUST treat
  // this as distinct from "analyzed and found nothing" — see assessment.ts.
  coverageIncomplete: boolean;
  moduleCoverage: ModuleCoverageEntry[];
}

const ANALYSIS_LIMIT_MODULE = "pdfRasterizer";

function mimeTypeFor(detected: DetectedFileType): string {
  switch (detected) {
    case "pdf":
      return "application/pdf";
    case "jpg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "tiff":
      return "image/tiff";
  }
}

// The single place that decides which analysis layers apply to a given file
// (spec §4/§5 — the caller never picks). Modules are plain functions; the AI
// step takes an injected AIAnalysisProvider so it (and, by the same pattern,
// the caller's AssessmentPolicy downstream) can be swapped without touching
// this orchestration logic.
export async function runVerificationAnalysis(input: OrchestratorInput): Promise<OrchestratorOutput> {
  const { detected, findings: integrityFindings } = analyzeFileIntegrity(
    input.buffer,
    input.declaredMimeType,
    input.filename,
  );
  const mimeType = mimeTypeFor(detected);
  const findings: Finding[] = [...integrityFindings];
  const moduleCoverage: ModuleCoverageEntry[] = [{ module: "fileIntegrity", status: "ran" }];

  // Cost control (spec §28): an exact match against a supplied reference
  // short-circuits every deeper layer — there is nothing more useful to
  // learn once byte-for-byte identity is established.
  if (input.reference && input.reference.sha256 === input.sha256) {
    const comparison = await analyzeReferenceComparison({
      originalSha256: input.reference.sha256,
      submittedSha256: input.sha256,
      originalText: input.reference.text,
      submittedText: input.reference.text,
      originalBuffer: input.reference.buffer,
      submittedBuffer: input.buffer,
      originalMimeType: input.reference.mimeType,
      submittedMimeType: mimeType,
    });
    const skipReason = "exact hash match against the supplied reference — no deeper analysis needed";
    moduleCoverage.push(
      { module: "referenceComparison", status: "ran" },
      ...[
        "pdfStructure",
        "typography",
        "imageSignal",
        "imageForensics",
        "regionForensics",
        "textExtraction",
        "textConsistency",
        "aiIndicators",
      ].map((module) => ({ module, status: "skipped" as const, reason: skipReason })),
    );
    return {
      detectedType: detected,
      pageCount: null,
      analyzedPageCount: null,
      extractedText: null,
      extractionMethod: null,
      findings: [...findings, ...comparison.findings],
      hashMatch: true,
      extractionFailed: false,
      coverageIncomplete: false,
      moduleCoverage,
    };
  }

  let pageCount: number | null = null;
  let analyzedPageCount: number | null = null;
  let extractionFailed = false;
  let coverageIncomplete = false;
  const metadataHints: string[] = [];

  if (detected === "pdf") {
    const [structure, typographyFindings] = await Promise.all([
      analyzePdfStructure(input.buffer),
      analyzeTypography(input.buffer),
    ]);
    findings.push(...structure.findings, ...typographyFindings);
    pageCount = structure.pageCount;
    extractionFailed = !structure.readable;
    if (structure.metadata?.producer) metadataHints.push(structure.metadata.producer);
    if (structure.metadata?.creator) metadataHints.push(structure.metadata.creator);
    moduleCoverage.push(
      structure.readable
        ? { module: "pdfStructure", status: "ran" }
        : { module: "pdfStructure", status: "failed", reason: "PDF could not be parsed" },
      { module: "typography", status: "ran" },
      { module: "imageSignal", status: "skipped", reason: "not applicable to a PDF" },
      { module: "imageForensics", status: "skipped", reason: "not applicable to PDF-embedded content this increment" },
    );

    // Region forensics (embedded-image/signature-field/grid-cell boundary
    // check) — only meaningful on a PDF that opened successfully.
    if (!extractionFailed) {
      findings.push(...(await analyzePdfRegionForensics(input.buffer)));
      moduleCoverage.push({ module: "regionForensics", status: "ran" });
    } else {
      moduleCoverage.push({ module: "regionForensics", status: "skipped", reason: "PDF could not be parsed" });
    }
  } else {
    const signal = await analyzeImageSignal(input.buffer);
    findings.push(...signal.findings);
    pageCount = signal.pageCount;
    extractionFailed = !signal.readable;
    if (signal.software) metadataHints.push(signal.software);
    moduleCoverage.push(
      signal.readable
        ? { module: "imageSignal", status: "ran" }
        : { module: "imageSignal", status: "failed", reason: "image could not be read" },
      { module: "pdfStructure", status: "skipped", reason: "not applicable to a standalone image" },
      { module: "typography", status: "skipped", reason: "not applicable to a standalone image" },
    );

    // Pixel-level forensics (ELA, copy-move, region boundary check) — only
    // meaningful on an image that opened successfully; standalone JPG/PNG/
    // TIFF uploads only (a rasterized PDF page has no original compression
    // history for ELA to compare against — see the Increment 4 plan).
    if (!extractionFailed) {
      const [imageForensicsFindings, regionForensicsFindings] = await Promise.all([
        analyzeImageForensics(input.buffer),
        analyzeImageRegionForensics(input.buffer),
      ]);
      findings.push(...imageForensicsFindings, ...regionForensicsFindings);
      moduleCoverage.push({ module: "imageForensics", status: "ran" }, { module: "regionForensics", status: "ran" });
    } else {
      moduleCoverage.push(
        { module: "imageForensics", status: "skipped", reason: "image could not be read" },
        { module: "regionForensics", status: "skipped", reason: "image could not be read" },
      );
    }
  }

  let extractedText: string | null = null;
  let extractionMethod: TextExtractionMethod | null = null;

  if (!extractionFailed) {
    try {
      const extracted = await getOrExtractText(input.sha256, input.buffer, mimeType);
      extractedText = extracted.text;
      extractionMethod = extracted.method;
      analyzedPageCount = extracted.analyzedPageCount;
      moduleCoverage.push({ module: "textExtraction", status: "ran" });

      if (extracted.analyzedPageCount < extracted.pageCount) {
        coverageIncomplete = true;
        // Severity is deliberately INFO, not HIGH: this finding describes a
        // *coverage limitation* (how much of the document we could check),
        // not evidence of manipulation (what we found) — those are separate
        // axes. Mixing them would let a coverage gap masquerade as "strong
        // evidence" via the normal severity-counting rules below. Its real
        // consequence — never letting this present as a clean LOW_CONCERN —
        // is handled explicitly via `coverageIncomplete` in assessment.ts.
        findings.push(
          finding({
            category: "PDF_STRUCTURE",
            severity: "INFO",
            confidence: null,
            description: `ANALYSIS_LIMIT_REACHED: only ${extracted.analyzedPageCount} of ${extracted.pageCount} pages could be analyzed. This document has NOT been fully reviewed — findings here reflect only the analyzed pages.`,
            evidence: { analyzedPageCount: extracted.analyzedPageCount, totalPageCount: extracted.pageCount },
            page: null,
            regions: null,
            module: ANALYSIS_LIMIT_MODULE,
          }),
        );
      }
    } catch {
      extractedText = null;
      // For PDFs, a thrown extraction error means direct extraction AND the
      // OCR-on-rasterized-pages fallback both came back empty (or
      // rasterization itself failed) — genuinely nothing readable, which
      // should reach INCONCLUSIVE, not a false LOW_CONCERN. For images, a
      // failure here is left non-fatal: pdfStructure/imageSignal already
      // proved the file opens fine, and a photo with no text in it (e.g. a
      // logo or seal) is normal, not a quality problem (spec §66 — one
      // sub-step failing shouldn't fail the whole thing).
      if (detected === "pdf") {
        extractionFailed = true;
        moduleCoverage.push({
          module: "textExtraction",
          status: "failed",
          reason: "no extractable text found, even after OCR on rendered pages",
        });
      } else {
        moduleCoverage.push({ module: "textExtraction", status: "ran" });
      }
    }
  } else {
    moduleCoverage.push({
      module: "textExtraction",
      status: "skipped",
      reason: "file structure could not be read",
    });
  }

  if (extractedText && extractedText.trim().length > 0) {
    findings.push(...analyzeTextConsistency(extractedText));
    moduleCoverage.push({ module: "textConsistency", status: "ran" });
  } else {
    moduleCoverage.push({ module: "textConsistency", status: "skipped", reason: "no extractable text" });
  }

  findings.push(
    ...(await analyzeAiIndicators(input.aiProvider, {
      buffer: input.buffer,
      mimeType,
      extractedText,
      metadataHints,
    })),
  );
  moduleCoverage.push({ module: "aiIndicators", status: "ran" });

  let hashMatch: boolean | null = null;
  if (input.reference) {
    const comparison = await analyzeReferenceComparison({
      originalSha256: input.reference.sha256,
      submittedSha256: input.sha256,
      originalText: input.reference.text,
      submittedText: extractedText ?? "",
      originalBuffer: input.reference.buffer,
      submittedBuffer: input.buffer,
      originalMimeType: input.reference.mimeType,
      submittedMimeType: mimeType,
    });
    findings.push(...comparison.findings);
    hashMatch = comparison.hashMatch;
    moduleCoverage.push({ module: "referenceComparison", status: "ran" });
  } else {
    moduleCoverage.push({
      module: "referenceComparison",
      status: "skipped",
      reason: "no reference document supplied",
    });
  }

  return {
    detectedType: detected,
    pageCount,
    analyzedPageCount,
    extractedText,
    extractionMethod,
    findings,
    hashMatch,
    extractionFailed,
    coverageIncomplete,
    moduleCoverage,
  };
}
