import type { ReviewDecisionStatus } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { HttpError } from "../../middleware/errorHandler.js";
import { recordAuditEvent } from "../audit/auditLog.js";

export interface ReviewEventView {
  id: string;
  status: ReviewDecisionStatus;
  reviewedById: string;
  notes: string | null;
  createdAt: Date;
}

// Append-only, same pattern as recordIssuerConfirmationEvent — this is the
// only writer the app uses for ReviewEvent, and it only ever creates rows.
// Never touches VerificationFinding/VerificationAssessment/
// IssuerConfirmationEvent: a reviewer decision is a judgment call layered
// on top of the other three concepts, never a mutation of any of them (see
// the schema comment on ReviewEvent).
export async function recordReviewEvent(
  organizationId: string,
  verificationRequestId: string,
  userId: string,
  params: { status: ReviewDecisionStatus; notes?: string },
): Promise<ReviewEventView> {
  const verificationRequest = await prisma.verificationRequest.findFirst({
    where: { id: verificationRequestId, organizationId },
  });
  if (!verificationRequest) {
    throw new HttpError(404, "Verification not found");
  }

  // currentReviewStatus is a denormalized cache of "the latest event's
  // status" (queue-filtering only, see the schema comment) — updated in the
  // same transaction as the event insert so it can never drift out of sync.
  const event = await prisma.$transaction(async (tx) => {
    const created = await tx.reviewEvent.create({
      data: {
        verificationRequestId,
        organizationId,
        status: params.status,
        reviewedById: userId,
        notes: params.notes ?? null,
      },
    });
    await tx.verificationRequest.update({
      where: { id: verificationRequestId },
      data: { currentReviewStatus: params.status },
    });
    return created;
  });

  await recordAuditEvent(prisma, {
    organizationId,
    userId,
    action: "review_decision_recorded",
    entityType: "VerificationRequest",
    entityId: verificationRequestId,
    metadata: { status: params.status },
  });

  return event;
}

export async function getReviewHistory(organizationId: string, verificationRequestId: string): Promise<ReviewEventView[]> {
  const verificationRequest = await prisma.verificationRequest.findFirst({
    where: { id: verificationRequestId, organizationId },
  });
  if (!verificationRequest) {
    throw new HttpError(404, "Verification not found");
  }

  return prisma.reviewEvent.findMany({
    where: { verificationRequestId, organizationId },
    orderBy: { createdAt: "asc" },
  });
}

// The verification's *current* review status is always "the most recent
// event" — never a separately-stored field. No events at all means no one
// has reviewed it yet, distinct from any real status value (mirrors
// deriveCurrentStatus in issuerConfirmation.ts).
export function deriveCurrentReviewStatus(history: ReviewEventView[]): ReviewDecisionStatus | "NOT_REVIEWED" {
  if (history.length === 0) return "NOT_REVIEWED";
  return history[history.length - 1].status;
}
