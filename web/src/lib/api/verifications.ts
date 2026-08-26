import { fetchAuthenticatedBlobUrl, request } from "./client.js";
import type {
  EvidenceReport,
  InvestigationView,
  IssuerConfirmationEventView,
  IssuerConfirmationStatus,
  ReviewDecisionStatus,
  ReviewEventView,
  ReviewStatusFilter,
  VerificationListItem,
  VerificationSubmitResult,
} from "./types.js";

export async function submitVerification(file: File): Promise<VerificationSubmitResult> {
  const form = new FormData();
  form.append("file", file);
  return request<VerificationSubmitResult>("/verifications", { method: "POST", body: form, isMultipart: true });
}

export function listVerifications(reviewStatus?: ReviewStatusFilter): Promise<VerificationListItem[]> {
  return request<VerificationListItem[]>("/verifications", { query: { reviewStatus } });
}

export function getVerificationReport(id: string): Promise<EvidenceReport> {
  return request<EvidenceReport>(`/verifications/${id}/report`);
}

export function getInvestigation(id: string): Promise<InvestigationView> {
  return request<InvestigationView>(`/verifications/${id}/investigation`);
}

export function getPageImageUrl(id: string, pageNumber: number): Promise<string> {
  return fetchAuthenticatedBlobUrl(`/verifications/${id}/pages/${pageNumber}/image`);
}

export function postIssuerConfirmation(
  id: string,
  params: { status: IssuerConfirmationStatus; contactMethod?: string; notes?: string },
): Promise<IssuerConfirmationEventView> {
  return request<IssuerConfirmationEventView>(`/verifications/${id}/issuer-confirmation`, { method: "POST", body: params });
}

export function postReviewDecision(id: string, params: { status: ReviewDecisionStatus; notes?: string }): Promise<ReviewEventView> {
  return request<ReviewEventView>(`/verifications/${id}/review`, { method: "POST", body: params });
}
