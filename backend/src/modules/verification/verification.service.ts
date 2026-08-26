import { randomUUID } from "node:crypto";
import { ClientPlatform, Prisma } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { env } from "../../config/env.js";
import { HttpError } from "../../middleware/errorHandler.js";
import { sha256Hex } from "../../lib/hash.js";
import { storageProvider } from "../storage/localDiskProvider.js";
import { recordAuditEvent } from "../audit/auditLog.js";
import { recordUsage } from "../billing/usage.js";
import { getEntitlementAccount } from "../billing/entitlements.js";
import { consumeEntitlement, refundEntitlement, InsufficientEntitlementError } from "../billing/ledger.js";
import { analyzeFileIntegrity, UnsupportedFileError } from "./analysis/fileIntegrity.js";
import { getAIAnalysisProvider, type AIAnalysisProvider } from "./analysis/aiIndicators.js";
import { getAssessmentPolicy, type AssessmentPolicy } from "./assessment.js";
import { getOrExtractText } from "./textExtraction.js";
import { textFingerprintHash } from "./textDiff.js";
import { runVerificationAnalysis, type ModuleCoverageEntry, type ReferenceInput } from "./orchestrator.js";
import type { Finding } from "./finding.js";

interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

async function resolveReference(organizationId: string, referenceDocumentId: string): Promise<ReferenceInput> {
  const document = await prisma.document.findFirst({
    where: { id: referenceDocumentId, organizationId },
    include: { currentVersion: true },
  });
  if (!document || !document.currentVersion) {
    throw new HttpError(404, "Reference document not found");
  }
  const version = document.currentVersion;

  const buffer = await storageProvider.get(version.storageKey);
  // Shared cache (textExtraction.ts), keyed by content hash — the same
  // cache the submitted file's own extraction uses, so a reference document
  // that also gets submitted as evidence elsewhere doesn't re-run OCR.
  const { text } = await getOrExtractText(version.sha256, buffer, version.mimeType);

  // Fulfills the nullable DocumentFingerprint.textFingerprint column from
  // Phase 1 — only along this path, since only a registered Document has a
  // DocumentFingerprint row to backfill.
  await prisma.documentFingerprint
    .update({ where: { documentVersionId: version.id }, data: { textFingerprint: textFingerprintHash(text) } })
    .catch(() => undefined); // fingerprint row is best-effort bookkeeping, never blocks verification

  return { buffer, mimeType: version.mimeType, sha256: version.sha256, text };
}

export interface SubmitVerificationOptions {
  aiProvider?: AIAnalysisProvider;
  assessmentPolicy?: AssessmentPolicy;
}

export interface VerificationOutcome {
  id: string;
  status: string;
  summary: string;
  recommendation: string;
  hashMatch: boolean | null;
  pageCount: number | null;
  analyzedPageCount: number | null;
  coverageIncomplete: boolean;
  moduleCoverage: ModuleCoverageEntry[];
  findings: Finding[];
  createdAt: Date;
}

export async function submitVerification(
  organizationId: string,
  userId: string,
  file: UploadedFile,
  referenceDocumentId: string | null,
  platform: ClientPlatform = ClientPlatform.WEB,
  options: SubmitVerificationOptions = {},
): Promise<VerificationOutcome> {
  // Fail fast, before storing anything, on a file that isn't one of the
  // supported types at all (spec Test 12 — clear error, never a crash).
  // The orchestrator re-derives this (cheap, synchronous, no I/O) for the
  // findings list itself; this pre-check just gates persistence.
  try {
    analyzeFileIntegrity(file.buffer, file.mimetype, file.originalname);
  } catch (err) {
    if (err instanceof UnsupportedFileError) {
      throw new HttpError(422, err.message);
    }
    throw err;
  }

  // Generated upfront (rather than left to Prisma's default) so the
  // entitlement ledger can reference this verification's id even though
  // consumption happens before the VerificationRequest row exists.
  const verificationRequestId = randomUUID();

  // If this organization has no EntitlementAccount, behavior is unchanged
  // from before billing existed — unlimited, nothing gates the request
  // (see the schema comment on Organization.planId). If it does have one,
  // consumption happens now, before any storage write or VerificationRequest
  // row — a rejected request leaves zero trace, the same discipline as the
  // 422 path above. HttpError(402) matches the HTTP "Payment Required"
  // semantics for "you're out of verifications."
  const account = await getEntitlementAccount(prisma, organizationId);
  if (account) {
    try {
      await prisma.$transaction((tx) => consumeEntitlement(tx, account.id, "VerificationRequest", verificationRequestId));
    } catch (err) {
      if (err instanceof InsufficientEntitlementError) {
        throw new HttpError(402, err.message);
      }
      throw err;
    }
  }

  const sha256 = sha256Hex(file.buffer);
  const reference = referenceDocumentId ? await resolveReference(organizationId, referenceDocumentId) : null;

  const storageKey = `${organizationId}/verifications/${randomUUID()}-${file.originalname}`;
  // Evidence-first ordering (same rationale as Phase 1 document registration):
  // if this write fails, nothing in the DB ever references a missing file.
  await storageProvider.put(storageKey, file.buffer);

  const verificationRequest = await prisma.verificationRequest.create({
    data: {
      id: verificationRequestId,
      organizationId,
      submittedById: userId,
      storageKey,
      mimeType: file.mimetype,
      sha256,
      originalFilename: file.originalname,
      sizeBytes: file.buffer.length,
      referenceDocumentId,
      status: "PROCESSING",
      platform,
    },
  });
  await recordAuditEvent(prisma, {
    organizationId,
    userId,
    action: "verification_created",
    entityType: "VerificationRequest",
    entityId: verificationRequest.id,
    metadata: { hasReference: Boolean(reference) },
  });
  await recordAuditEvent(prisma, {
    organizationId,
    userId,
    action: "file_validated",
    entityType: "VerificationRequest",
    entityId: verificationRequest.id,
  });

  const aiProvider = options.aiProvider ?? getAIAnalysisProvider(env.AI_ANALYSIS_PROVIDER);
  let analysis;
  try {
    analysis = await runVerificationAnalysis({
      buffer: file.buffer,
      sha256,
      declaredMimeType: file.mimetype,
      filename: file.originalname,
      reference,
      aiProvider,
    });
  } catch (err) {
    // Single-phase "consume, refund-on-failure" — see the plan's tradeoff
    // note: sufficient because analysis is synchronous (no polling), so the
    // exposure window here is the same small window every other side
    // effect in this function already has.
    if (account) {
      await prisma.$transaction((tx) => refundEntitlement(tx, account.id, "VerificationRequest", verificationRequestId));
    }
    throw err;
  }

  await recordAuditEvent(prisma, {
    organizationId,
    userId,
    action: "analysis_completed",
    entityType: "VerificationRequest",
    entityId: verificationRequest.id,
    metadata: { findingCount: analysis.findings.length, extractionFailed: analysis.extractionFailed },
  });

  const assessmentPolicy = options.assessmentPolicy ?? getAssessmentPolicy();
  const assessmentOutcome = assessmentPolicy.assess({
    findings: analysis.findings,
    hasReference: Boolean(reference),
    hashMatch: analysis.hashMatch,
    extractionFailed: analysis.extractionFailed,
    coverageIncomplete: analysis.coverageIncomplete,
  });

  const assessment = await prisma.$transaction(async (tx) => {
    await tx.verificationRequest.update({
      where: { id: verificationRequest.id },
      data: {
        status: "COMPLETE",
        pageCount: analysis.pageCount,
        analyzedPageCount: analysis.analyzedPageCount,
        coverageIncomplete: analysis.coverageIncomplete,
        moduleCoverage: analysis.moduleCoverage as unknown as Prisma.InputJsonValue,
      },
    });

    if (analysis.findings.length > 0) {
      await tx.verificationFinding.createMany({
        data: analysis.findings.map((f) => ({
          verificationRequestId: verificationRequest.id,
          category: f.category,
          severity: f.severity,
          confidence: f.confidence,
          description: f.description,
          evidence: (f.evidence ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          page: f.page,
          regions: (f.regions ?? Prisma.JsonNull) as unknown as Prisma.InputJsonValue,
          module: f.module,
        })),
      });
    }

    const createdAssessment = await tx.verificationAssessment.create({
      data: {
        verificationRequestId: verificationRequest.id,
        status: assessmentOutcome.status,
        summary: assessmentOutcome.summary,
        recommendation: assessmentOutcome.recommendation,
      },
    });

    // Only reached once analysis has actually produced an assessment — see
    // the placement rationale in modules/billing/usage.ts.
    await recordUsage(tx, {
      organizationId,
      userId,
      verificationRequestId: verificationRequest.id,
      platform,
      at: verificationRequest.createdAt,
    });

    return createdAssessment;
  });

  return {
    id: verificationRequest.id,
    status: assessment.status,
    summary: assessment.summary,
    recommendation: assessment.recommendation,
    hashMatch: analysis.hashMatch,
    pageCount: analysis.pageCount,
    analyzedPageCount: analysis.analyzedPageCount,
    coverageIncomplete: analysis.coverageIncomplete,
    moduleCoverage: analysis.moduleCoverage,
    findings: analysis.findings,
    createdAt: verificationRequest.createdAt,
  };
}

export type ReviewStatusFilter = "NOT_REVIEWED" | "IN_REVIEW" | "CONFIRMED_AUTHENTIC" | "CONFIRMED_MODIFICATION" | "INSUFFICIENT_EVIDENCE" | "REQUEST_MORE_INFORMATION" | "FALSE_POSITIVE";

export async function listVerifications(organizationId: string, reviewStatus?: ReviewStatusFilter) {
  return prisma.verificationRequest.findMany({
    where: {
      organizationId,
      ...(reviewStatus ? { currentReviewStatus: reviewStatus === "NOT_REVIEWED" ? null : reviewStatus } : {}),
    },
    include: { assessment: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function getVerificationReport(organizationId: string, verificationRequestId: string) {
  const request = await prisma.verificationRequest.findFirst({
    where: { id: verificationRequestId, organizationId },
    include: {
      findings: { orderBy: { createdAt: "asc" } },
      assessment: true,
      referenceDocument: true,
      issuerConfirmationEvents: { orderBy: { createdAt: "asc" } },
      submittedBy: { select: { name: true } },
    },
  });
  if (!request) {
    throw new HttpError(404, "Verification not found");
  }
  return request;
}

// Every existing audit call in this module already uses this
// (entityType, entityId) convention (verification_created, file_validated,
// analysis_completed, issuer_confirmation_*, review_decision_recorded) —
// this is the first place anything queries it back out.
export async function getVerificationAuditHistory(organizationId: string, verificationRequestId: string) {
  const verificationRequest = await prisma.verificationRequest.findFirst({
    where: { id: verificationRequestId, organizationId },
  });
  if (!verificationRequest) {
    throw new HttpError(404, "Verification not found");
  }

  return prisma.auditLog.findMany({
    where: { organizationId, entityType: "VerificationRequest", entityId: verificationRequestId },
    orderBy: { createdAt: "asc" },
  });
}
