import type { IssuerConfirmationStatus } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { HttpError } from "../../middleware/errorHandler.js";
import { recordAuditEvent } from "../audit/auditLog.js";

export interface IssuerConfirmationEventView {
  id: string;
  status: IssuerConfirmationStatus;
  recordedById: string;
  contactMethod: string | null;
  notes: string | null;
  createdAt: Date;
}

// Append-only, same pattern as recordAuditEvent — this is the only writer
// the app uses for IssuerConfirmationEvent, and it only ever creates rows.
// Never touches VerificationFinding/VerificationAssessment: the forensic
// report is immutable evidence whether or not issuer confirmation ever
// happens (see the schema comment on IssuerConfirmationEvent).
export async function recordIssuerConfirmationEvent(
  organizationId: string,
  verificationRequestId: string,
  userId: string,
  params: { status: IssuerConfirmationStatus; contactMethod?: string; notes?: string },
): Promise<IssuerConfirmationEventView> {
  const verificationRequest = await prisma.verificationRequest.findFirst({
    where: { id: verificationRequestId, organizationId },
  });
  if (!verificationRequest) {
    throw new HttpError(404, "Verification not found");
  }

  const event = await prisma.issuerConfirmationEvent.create({
    data: {
      verificationRequestId,
      organizationId,
      status: params.status,
      recordedById: userId,
      contactMethod: params.contactMethod ?? null,
      notes: params.notes ?? null,
    },
  });

  await recordAuditEvent(prisma, {
    organizationId,
    userId,
    action: params.status === "REQUESTED" ? "issuer_confirmation_requested" : "issuer_confirmation_recorded",
    entityType: "VerificationRequest",
    entityId: verificationRequestId,
    metadata: { status: params.status },
  });

  return event;
}

export async function getIssuerConfirmationHistory(
  organizationId: string,
  verificationRequestId: string,
): Promise<IssuerConfirmationEventView[]> {
  const verificationRequest = await prisma.verificationRequest.findFirst({
    where: { id: verificationRequestId, organizationId },
  });
  if (!verificationRequest) {
    throw new HttpError(404, "Verification not found");
  }

  return prisma.issuerConfirmationEvent.findMany({
    where: { verificationRequestId, organizationId },
    orderBy: { createdAt: "asc" },
  });
}

// The verification's *current* status is always "the most recent event" —
// never a separately-stored field. No events at all means confirmation was
// never requested, which is a distinct state from any real status value
// (deliberately not folded into the enum — "no request made" and "request
// made, no response yet" (REQUESTED) are different facts).
export function deriveCurrentStatus(history: IssuerConfirmationEventView[]): IssuerConfirmationStatus | "NOT_REQUESTED" {
  if (history.length === 0) return "NOT_REQUESTED";
  return history[history.length - 1].status;
}
