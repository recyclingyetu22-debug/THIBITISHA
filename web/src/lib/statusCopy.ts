// Single source of truth for every status label shown anywhere in this app.
// Never say "authentic"/"genuine" for an absence of findings — see the
// backend's own assessment.ts, which this mirrors in spirit. If a new status
// value is ever added on the backend, TypeScript's exhaustiveness on these
// Record types will fail to compile until it's added here too.
//
// Every entry also carries `why` — the copy shown behind a "Why?" tap next
// to the status badge. This is what lets someone looking at e.g. SUSPICIOUS
// understand what it actually means in plain language without reading
// forensic detail.
import type { FindingSeverity, IssuerConfirmationStatus, ReviewDecisionStatus, VerificationAssessmentStatus } from "./api/types.js";

export type Tone = "clear" | "caution" | "danger" | "info" | "match";

export const ASSESSMENT_STATUS_COPY: Record<VerificationAssessmentStatus, { label: string; tone: Tone; why: string }> = {
  LOW_CONCERN: {
    label: "No significant manipulation indicators detected",
    tone: "clear",
    why: "Our automated checks did not find evidence of tampering. This does not mean the document is confirmed authentic — it means nothing suspicious was found by this analysis. For certainty, contact the claimed issuer directly.",
  },
  SUSPICIOUS: {
    label: "Manipulation indicators detected — review recommended",
    tone: "caution",
    why: "Our automated checks found indicators worth a closer look, but nothing severe enough to call high risk. It does not mean the document is fake — a human reviewer should weigh the specific findings below.",
  },
  HIGH_RISK: {
    label: "Strong manipulation indicators detected",
    tone: "danger",
    why: "Our automated checks found strong, often multiple, indicators of tampering. This document should be treated with significant caution until an investigator or the claimed issuer confirms otherwise.",
  },
  INCONCLUSIVE: {
    label: "Unable to reach a reliable conclusion",
    tone: "info",
    why: "The analysis could not produce a reliable result — for example, the document's content couldn't be fully extracted or read. This is not a finding either way; it means this analysis alone can't tell you much.",
  },
  VERIFIED_MATCH: {
    label: "Matches the supplied reference document",
    tone: "match",
    why: "This document was compared against a reference document your organization supplied, and it matches. This is a different, stronger claim than \"no indicators detected\" — it's a direct comparison, not just an absence of red flags.",
  },
  MODIFIED: {
    label: "Differs from the supplied reference document",
    tone: "danger",
    why: "This document was compared against a reference document your organization supplied, and it differs from it. Review what specifically changed in the evidence below.",
  },
};

export const ISSUER_CONFIRMATION_COPY: Record<IssuerConfirmationStatus | "NOT_REQUESTED", { label: string; tone: Tone; why: string }> = {
  NOT_REQUESTED: {
    label: "Not requested",
    tone: "info",
    why: "No one has asked the claimed issuing organization to confirm this document yet. This is the normal state for most verifications.",
  },
  REQUESTED: {
    label: "Requested — awaiting response",
    tone: "caution",
    why: "An investigator has reached out to the claimed issuing organization to confirm this document, and is waiting to hear back.",
  },
  CONFIRMED_GENUINE: {
    label: "Issuer confirmed this document as genuine",
    tone: "clear",
    why: "The claimed issuing organization was contacted directly and confirmed they issued this document. This is independent of, and stronger than, the automated forensic result above.",
  },
  CONFIRMED_MODIFIED: {
    label: "Issuer confirmed this document was modified",
    tone: "danger",
    why: "The claimed issuing organization was contacted directly and confirmed this document does not match what they actually issued.",
  },
  DENIED_ISSUANCE: {
    label: "Issuer denies having issued this document",
    tone: "danger",
    why: "The claimed issuing organization says they never issued this document at all.",
  },
  UNREACHABLE: {
    label: "Issuer could not be reached",
    tone: "info",
    why: "An investigator attempted to contact the claimed issuing organization but could not reach them.",
  },
  DECLINED_TO_CONFIRM: {
    label: "Issuer declined to confirm",
    tone: "info",
    why: "The claimed issuing organization was reached but declined to confirm or deny this document.",
  },
};

export const REVIEW_DECISION_COPY: Record<ReviewDecisionStatus | "NOT_REVIEWED", { label: string; tone: Tone; why: string }> = {
  NOT_REVIEWED: {
    label: "Not reviewed",
    tone: "info",
    why: "No investigator has recorded a decision on this verification yet.",
  },
  IN_REVIEW: {
    label: "In review",
    tone: "caution",
    why: "An investigator has started looking into this verification. This is a status marker, not a final decision.",
  },
  CONFIRMED_AUTHENTIC: {
    label: "Confirmed authentic by reviewer",
    tone: "clear",
    why: "A human investigator weighed the forensic assessment, any reference comparison, and any issuer confirmation, and made the judgment call that this document is authentic.",
  },
  CONFIRMED_MODIFICATION: {
    label: "Confirmed modification by reviewer",
    tone: "danger",
    why: "A human investigator weighed all available evidence and made the judgment call that this document has been modified.",
  },
  INSUFFICIENT_EVIDENCE: {
    label: "Insufficient evidence to decide",
    tone: "info",
    why: "An investigator reviewed this verification and determined there isn't enough evidence to reach a confident decision either way.",
  },
  REQUEST_MORE_INFORMATION: {
    label: "More information requested",
    tone: "caution",
    why: "An investigator needs more information before they can decide — for example, a clearer scan or a response from the issuer.",
  },
  FALSE_POSITIVE: {
    label: "Determined to be a false positive",
    tone: "clear",
    why: "An investigator reviewed the automated findings and determined they don't actually indicate a problem with this document.",
  },
};

export const SEVERITY_COPY: Record<FindingSeverity, { label: string; tone: Tone }> = {
  INFO: { label: "Info", tone: "info" },
  LOW: { label: "Low", tone: "clear" },
  MEDIUM: { label: "Medium", tone: "caution" },
  HIGH: { label: "High", tone: "danger" },
};

export const ALL_REVIEW_DECISION_STATUSES: ReviewDecisionStatus[] = [
  "IN_REVIEW",
  "CONFIRMED_AUTHENTIC",
  "CONFIRMED_MODIFICATION",
  "INSUFFICIENT_EVIDENCE",
  "REQUEST_MORE_INFORMATION",
  "FALSE_POSITIVE",
];

export const ALL_ISSUER_CONFIRMATION_STATUSES: IssuerConfirmationStatus[] = [
  "REQUESTED",
  "CONFIRMED_GENUINE",
  "CONFIRMED_MODIFIED",
  "DENIED_ISSUANCE",
  "UNREACHABLE",
  "DECLINED_TO_CONFIRM",
];
