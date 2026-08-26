import type { VerificationAssessmentStatus } from "@prisma/client";
import type { Finding } from "./finding.js";

export interface AssessmentContext {
  findings: Finding[];
  hasReference: boolean;
  hashMatch: boolean | null; // null when no reference was supplied
  extractionFailed: boolean; // file/pages couldn't be read reliably at all
  // True whenever fewer pages were analyzed than the document actually has
  // (see orchestrator.ts / pdfRasterizer.ts). This must never be allowed to
  // present as a clean bill of health: a policy MUST NOT resolve to
  // LOW_CONCERN when coverage is incomplete — "nothing found" is only
  // meaningful if the whole document was actually looked at. SUSPICIOUS/
  // HIGH_RISK/MODIFIED conclusions from the pages that WERE analyzed are
  // still surfaced as-is (real evidence found shouldn't be hidden behind an
  // "inconclusive" label), just with the coverage gap called out alongside.
  coverageIncomplete: boolean;
}

export interface AssessmentOutcome {
  status: VerificationAssessmentStatus;
  summary: string;
  recommendation: string;
}

// The engine depends on this interface, not on RuleBasedAssessmentPolicy
// directly (verification.service.ts takes a policy instance, defaulting to
// this one) — the current severity thresholds are an *initial classification
// policy*, not a final fraud-risk model, and swapping in a weighted/learned
// scoring model later must not require touching the orchestrator or service.
// Proven by test/assessmentPolicySwap.test.ts.
export interface AssessmentPolicy {
  readonly name: string;
  assess(context: AssessmentContext): AssessmentOutcome;
}

const NO_AUTHENTICITY_CLAIM_NOTE =
  "This analysis does not independently verify the document's authenticity. If certainty is required, contact the claimed issuer directly.";

const COVERAGE_CAVEAT =
  "Not every page of this document could be analyzed — see the ANALYSIS_LIMIT_REACHED finding for exactly which pages were and weren't reviewed. This is a partial result, not a clean bill of health for the whole document.";

export interface RuleBasedAssessmentPolicyConfig {
  /** severity is HIGH_RISK once this many MEDIUM-or-above findings accumulate, even with no single HIGH finding */
  mediumFindingsEscalateToHighRisk: number;
}

const DEFAULT_CONFIG: RuleBasedAssessmentPolicyConfig = {
  mediumFindingsEscalateToHighRisk: 2,
};

// Increment 1's policy: transparent, rule-based severity aggregation. Not a
// weighted risk score (that needs the deeper forensic layers — PDF
// object-graph analysis, real image forensics — that later increments add)
// but deliberately built behind the AssessmentPolicy interface so a future
// policy can replace this without changing anything that calls it.
export class RuleBasedAssessmentPolicy implements AssessmentPolicy {
  readonly name = "rule-based-v1";

  constructor(private readonly config: RuleBasedAssessmentPolicyConfig = DEFAULT_CONFIG) {}

  assess(context: AssessmentContext): AssessmentOutcome {
    const outcome = context.hasReference ? this.assessWithReference(context) : this.assessStandalone(context);
    return context.coverageIncomplete ? this.applyCoverageCaveat(outcome) : outcome;
  }

  // Never lets incomplete coverage present as LOW_CONCERN (spec concern:
  // "the modification was on the one page we never looked at"). A
  // SUSPICIOUS/HIGH_RISK/MODIFIED conclusion from the pages actually
  // analyzed is left standing — that's real evidence, not a false negative
  // — but always gets the coverage gap appended so it's never read as
  // exhaustive.
  private applyCoverageCaveat(outcome: AssessmentOutcome): AssessmentOutcome {
    if (outcome.status === "LOW_CONCERN") {
      return {
        status: "INCONCLUSIVE",
        summary: `${outcome.summary} However, this document could not be fully analyzed.`,
        recommendation: COVERAGE_CAVEAT,
      };
    }
    return { ...outcome, recommendation: `${outcome.recommendation} ${COVERAGE_CAVEAT}` };
  }

  private assessWithReference(context: AssessmentContext): AssessmentOutcome {
    if (context.hashMatch) {
      return {
        status: "VERIFIED_MATCH",
        summary: "The submitted document is byte-identical to the supplied reference document.",
        recommendation:
          "This confirms the submission matches the reference exactly. It does not independently establish that the reference document itself is authentic — that assurance can only come from its original source.",
      };
    }

    const hasTextDifference = context.findings.some(
      (f) => f.category === "REFERENCE_COMPARISON" && f.severity === "HIGH",
    );

    if (hasTextDifference) {
      return {
        status: "MODIFIED",
        summary: "The submitted document's content differs from the supplied reference document.",
        recommendation:
          "Review the specific differences listed in the findings before relying on this document. " +
          NO_AUTHENTICITY_CLAIM_NOTE,
      };
    }

    return {
      status: "LOW_CONCERN",
      summary:
        "The submitted document is not byte-identical to the reference, but no meaningful content differences were found (consistent with a re-scan or re-save).",
      recommendation: NO_AUTHENTICITY_CLAIM_NOTE,
    };
  }

  private assessStandalone(context: AssessmentContext): AssessmentOutcome {
    if (context.extractionFailed) {
      return {
        status: "INCONCLUSIVE",
        summary: "The submitted file's quality or format did not allow a reliable analysis.",
        recommendation: "Consider requesting a clearer copy of the document and submitting it again.",
      };
    }

    const highCount = context.findings.filter((f) => f.severity === "HIGH").length;
    const mediumCount = context.findings.filter((f) => f.severity === "MEDIUM").length;

    if (highCount > 0 || mediumCount >= this.config.mediumFindingsEscalateToHighRisk) {
      return {
        status: "HIGH_RISK",
        summary: "Multiple or strong indicators of possible manipulation were detected.",
        recommendation:
          "Do not rely on this document without further verification. Review the findings carefully and contact the claimed issuer. " +
          NO_AUTHENTICITY_CLAIM_NOTE,
      };
    }

    if (mediumCount > 0) {
      return {
        status: "SUSPICIOUS",
        summary: "One or more anomalies were detected that warrant a closer look before relying on this document.",
        recommendation:
          "Review the findings below and consider contacting the claimed issuer before relying on this document. " +
          NO_AUTHENTICITY_CLAIM_NOTE,
      };
    }

    return {
      status: "LOW_CONCERN",
      summary: "No significant manipulation indicators were detected.",
      recommendation: NO_AUTHENTICITY_CLAIM_NOTE,
    };
  }
}

export function getAssessmentPolicy(): AssessmentPolicy {
  return new RuleBasedAssessmentPolicy();
}
