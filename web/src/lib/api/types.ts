// Hand-transcribed from the backend's response shapes (see
// backend/src/modules/verification/{evidenceReport,finding,investigationView,
// issuerConfirmation,reviewDecision}.ts). Duplicated rather than shared via a
// workspace package — a deliberate scope trim for this first UI pass.

export type FindingCategory =
  | "FILE_INTEGRITY"
  | "PDF_STRUCTURE"
  | "TEXT_CONSISTENCY"
  | "IMAGE_SIGNAL"
  | "AI_INDICATOR"
  | "REFERENCE_COMPARISON"
  | "TYPOGRAPHY"
  | "REGION_FORENSICS";

export type FindingSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH";

export type VerificationAssessmentStatus = "LOW_CONCERN" | "SUSPICIOUS" | "HIGH_RISK" | "INCONCLUSIVE" | "VERIFIED_MATCH" | "MODIFIED";

export type IssuerConfirmationStatus = "REQUESTED" | "CONFIRMED_GENUINE" | "CONFIRMED_MODIFIED" | "DENIED_ISSUANCE" | "UNREACHABLE" | "DECLINED_TO_CONFIRM";

export type ReviewDecisionStatus =
  | "IN_REVIEW"
  | "CONFIRMED_AUTHENTIC"
  | "CONFIRMED_MODIFICATION"
  | "INSUFFICIENT_EVIDENCE"
  | "REQUEST_MORE_INFORMATION"
  | "FALSE_POSITIVE";

export type VerificationRequestStatus = "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED";

export type Role = "SUPER_ADMIN" | "ORG_ADMIN" | "DOCUMENT_OFFICER" | "INVESTIGATOR" | "VERIFIER" | "API_CLIENT";

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
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

export interface ModuleCoverageEntry {
  module: string;
  status: "ran" | "skipped" | "failed";
  reason?: string;
}

export interface CorrelationCluster {
  page: number | null;
  region: PixelRect | null;
  moduleCount: number;
  modules: string[];
  findingCount: number;
  maxSeverity: FindingSeverity;
  corroborated: boolean;
}

export interface IssuerConfirmationEventView {
  id: string;
  status: IssuerConfirmationStatus;
  recordedById: string;
  contactMethod: string | null;
  notes: string | null;
  createdAt: string;
}

export interface ReviewEventView {
  id: string;
  status: ReviewDecisionStatus;
  reviewedById: string;
  notes: string | null;
  createdAt: string;
}

export interface AuditHistoryEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  createdAt: string;
}

export interface EvidenceReport {
  document: { filename: string; mimeType: string; sha256: string; sizeBytes: number; analyzedAt: string; submittedByName: string };
  executiveSummary: string;
  overallAssessment: { status: VerificationAssessmentStatus; summary: string } | null;
  assessmentConfidence: AssessmentConfidence;
  keyFindings: FindingView[];
  findings: Record<string, FindingView[]>;
  correlatedFindings: CorrelationCluster[];
  affectedPages: number[];
  coverage: { pages: { pageCount: number | null; analyzedPageCount: number | null; complete: boolean }; modules: ModuleCoverageEntry[] };
  limitations: string[];
  recommendation: string | null;
  referenceComparison: { available: boolean; documentId: string | null; documentNumber: string | null };
  issuerConfirmation: { status: IssuerConfirmationStatus | "NOT_REQUESTED"; history: IssuerConfirmationEventView[] };
}

export interface InvestigationView extends EvidenceReport {
  reviewDecision: { status: ReviewDecisionStatus | "NOT_REVIEWED"; history: ReviewEventView[] };
  auditHistory: AuditHistoryEntry[];
}

export type ReviewStatusFilter =
  | "NOT_REVIEWED"
  | "IN_REVIEW"
  | "CONFIRMED_AUTHENTIC"
  | "CONFIRMED_MODIFICATION"
  | "INSUFFICIENT_EVIDENCE"
  | "REQUEST_MORE_INFORMATION"
  | "FALSE_POSITIVE";

export interface VerificationListItem {
  id: string;
  originalFilename: string;
  mimeType: string;
  status: VerificationRequestStatus;
  referenceDocumentId: string | null;
  assessment: { status: VerificationAssessmentStatus; summary: string } | null;
  coverageIncomplete: boolean;
  reviewStatus: ReviewStatusFilter;
  createdAt: string;
}

export interface VerificationSubmitResult {
  id: string;
  status: VerificationAssessmentStatus;
  summary: string;
  recommendation: string;
  hashMatch: boolean | null;
  pageCount: number | null;
  analyzedPageCount: number | null;
  coverageIncomplete: boolean;
  findingCount: number;
  createdAt: string;
}
