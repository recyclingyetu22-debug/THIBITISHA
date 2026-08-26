import type { ReviewDecisionStatus } from "@prisma/client";
import { buildEvidenceReport, type EvidenceReport, type EvidenceReportInput } from "./evidenceReport.js";
import { deriveCurrentReviewStatus, type ReviewEventView } from "./reviewDecision.js";

export interface AuditHistoryEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  createdAt: Date;
}

export interface InvestigationView extends EvidenceReport {
  reviewDecision: { status: ReviewDecisionStatus | "NOT_REVIEWED"; history: ReviewEventView[] };
  auditHistory: AuditHistoryEntry[];
}

// Composes the existing evidence report unchanged (buildEvidenceReport is
// not reimplemented or forked here) with the two things an investigator
// workspace needs beyond what an external report consumer should see:
// reviewer decisions and the internal audit trail.
export function buildInvestigationView(
  input: EvidenceReportInput,
  reviewHistory: ReviewEventView[],
  auditHistory: AuditHistoryEntry[],
): InvestigationView {
  const report = buildEvidenceReport(input);
  return {
    ...report,
    reviewDecision: { status: deriveCurrentReviewStatus(reviewHistory), history: reviewHistory },
    auditHistory,
  };
}
