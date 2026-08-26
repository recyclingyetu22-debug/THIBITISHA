import { Router } from "express";
import { z } from "zod";
import { ClientPlatform, IssuerConfirmationStatus, ReviewDecisionStatus, Role } from "@prisma/client";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { attachTenant, type TenantScopedRequest } from "../../middleware/tenant.js";
import { upload } from "../../middleware/upload.js";
import { HttpError } from "../../middleware/errorHandler.js";
import {
  getVerificationAuditHistory,
  getVerificationReport,
  listVerifications,
  submitVerification,
} from "./verification.service.js";
import { buildEvidenceReport } from "./evidenceReport.js";
import { buildInvestigationView } from "./investigationView.js";
import { getIssuerConfirmationHistory, recordIssuerConfirmationEvent } from "./issuerConfirmation.js";
import { getReviewHistory, recordReviewEvent } from "./reviewDecision.js";
import { getVerificationPageImage } from "./pageImage.js";

export const verificationRouter = Router();

verificationRouter.use(requireAuth, attachTenant);

verificationRouter.post(
  "/verifications",
  requireRole(Role.ORG_ADMIN, Role.DOCUMENT_OFFICER, Role.INVESTIGATOR, Role.VERIFIER),
  upload.single("file"),
  async (req, res, next) => {
    try {
      const request = req as unknown as TenantScopedRequest;
      if (!req.file) {
        throw new HttpError(400, "A file is required");
      }
      const referenceDocumentId =
        typeof req.body.referenceDocumentId === "string" && req.body.referenceDocumentId.length > 0
          ? req.body.referenceDocumentId
          : null;

      const headerPlatform = req.header("X-Client-Platform")?.toUpperCase();
      const platform =
        headerPlatform && headerPlatform in ClientPlatform ? (headerPlatform as ClientPlatform) : ClientPlatform.WEB;

      const outcome = await submitVerification(
        request.orgId,
        request.auth!.sub,
        { buffer: req.file.buffer, mimetype: req.file.mimetype, originalname: req.file.originalname },
        referenceDocumentId,
        platform,
      );

      res.status(201).json({
        id: outcome.id,
        status: outcome.status,
        summary: outcome.summary,
        recommendation: outcome.recommendation,
        hashMatch: outcome.hashMatch,
        pageCount: outcome.pageCount,
        analyzedPageCount: outcome.analyzedPageCount,
        coverageIncomplete: outcome.coverageIncomplete,
        findingCount: outcome.findings.length,
        createdAt: outcome.createdAt,
      });
    } catch (err) {
      next(err);
    }
  },
);

const reviewStatusFilterSchema = z.enum([
  "NOT_REVIEWED",
  "IN_REVIEW",
  "CONFIRMED_AUTHENTIC",
  "CONFIRMED_MODIFICATION",
  "INSUFFICIENT_EVIDENCE",
  "REQUEST_MORE_INFORMATION",
  "FALSE_POSITIVE",
]);

verificationRouter.get("/verifications", async (req, res, next) => {
  try {
    const request = req as unknown as TenantScopedRequest;
    const reviewStatus = req.query.reviewStatus !== undefined ? reviewStatusFilterSchema.parse(req.query.reviewStatus) : undefined;
    const requests = await listVerifications(request.orgId, reviewStatus);
    res.json(
      requests.map((r) => ({
        id: r.id,
        originalFilename: r.originalFilename,
        mimeType: r.mimeType,
        status: r.status,
        referenceDocumentId: r.referenceDocumentId,
        assessment: r.assessment ? { status: r.assessment.status, summary: r.assessment.summary } : null,
        coverageIncomplete: r.coverageIncomplete,
        reviewStatus: r.currentReviewStatus ?? "NOT_REVIEWED",
        createdAt: r.createdAt,
      })),
    );
  } catch (err) {
    next(err);
  }
});

verificationRouter.get("/verifications/:id", async (req, res, next) => {
  try {
    const request = req as unknown as TenantScopedRequest;
    const result = await getVerificationReport(request.orgId, req.params.id);
    res.json({
      id: result.id,
      originalFilename: result.originalFilename,
      mimeType: result.mimeType,
      sha256: result.sha256,
      sizeBytes: result.sizeBytes,
      status: result.status,
      referenceDocumentId: result.referenceDocumentId,
      assessment: result.assessment
        ? { status: result.assessment.status, summary: result.assessment.summary, recommendation: result.assessment.recommendation }
        : null,
      pageCount: result.pageCount,
      analyzedPageCount: result.analyzedPageCount,
      coverageIncomplete: result.coverageIncomplete,
      findingCount: result.findings.length,
      createdAt: result.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

verificationRouter.get("/verifications/:id/report", async (req, res, next) => {
  try {
    const request = req as unknown as TenantScopedRequest;
    const result = await getVerificationReport(request.orgId, req.params.id);
    res.json(buildEvidenceReport({ ...result, submittedByName: result.submittedBy.name }));
  } catch (err) {
    next(err);
  }
});

const issuerConfirmationEventSchema = z.object({
  status: z.nativeEnum(IssuerConfirmationStatus),
  contactMethod: z.string().max(200).optional(),
  notes: z.string().max(5000).optional(),
});

// Same endpoint handles both "mark as requiring issuer confirmation"
// (status: REQUESTED) and "record the issuer's response" (any other
// status) — both are just "append one more event" (see the schema comment
// on IssuerConfirmationEvent). Never touches VerificationFinding/
// VerificationAssessment — the forensic report stays immutable regardless.
verificationRouter.post(
  "/verifications/:id/issuer-confirmation",
  requireRole(Role.ORG_ADMIN, Role.INVESTIGATOR),
  async (req, res, next) => {
    try {
      const request = req as unknown as TenantScopedRequest;
      const body = issuerConfirmationEventSchema.parse(req.body);
      const event = await recordIssuerConfirmationEvent(request.orgId, req.params.id, request.auth!.sub, body);
      res.status(201).json(event);
    } catch (err) {
      next(err);
    }
  },
);

verificationRouter.get("/verifications/:id/issuer-confirmation", async (req, res, next) => {
  try {
    const request = req as unknown as TenantScopedRequest;
    const history = await getIssuerConfirmationHistory(request.orgId, req.params.id);
    res.json(history);
  } catch (err) {
    next(err);
  }
});

const reviewEventSchema = z.object({
  status: z.nativeEnum(ReviewDecisionStatus),
  notes: z.string().max(5000).optional(),
});

// A reviewer decision is a judgment call layered on top of forensic
// assessment + reference comparison + issuer confirmation — it never
// touches any of those three (see the schema comment on ReviewEvent).
verificationRouter.post(
  "/verifications/:id/review",
  requireRole(Role.ORG_ADMIN, Role.INVESTIGATOR),
  async (req, res, next) => {
    try {
      const request = req as unknown as TenantScopedRequest;
      const body = reviewEventSchema.parse(req.body);
      const event = await recordReviewEvent(request.orgId, req.params.id, request.auth!.sub, body);
      res.status(201).json(event);
    } catch (err) {
      next(err);
    }
  },
);

verificationRouter.get("/verifications/:id/review", async (req, res, next) => {
  try {
    const request = req as unknown as TenantScopedRequest;
    const history = await getReviewHistory(request.orgId, req.params.id);
    res.json(history);
  } catch (err) {
    next(err);
  }
});

// Existing rasterization capability (pdfRasterizer.ts), exposed via an
// endpoint for the first time — not a new detector. The PNG's pixel space
// matches every finding's `regions` exactly (RASTERIZE_SCALE), so a UI can
// overlay region highlights with zero coordinate transformation.
verificationRouter.get("/verifications/:id/pages/:pageNumber/image", async (req, res, next) => {
  try {
    const request = req as unknown as TenantScopedRequest;
    const pageNumber = Number(req.params.pageNumber);
    if (!Number.isInteger(pageNumber)) {
      throw new HttpError(400, "Page number must be an integer");
    }
    const { buffer, mimeType } = await getVerificationPageImage(request.orgId, req.params.id, pageNumber);
    res.setHeader("Content-Type", mimeType);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// More restrictively role-gated than /report: audit entries and reviewer
// notes are more internal than the forensic findings themselves, which
// other roles (e.g. VERIFIER) can already see via /report.
verificationRouter.get(
  "/verifications/:id/investigation",
  requireRole(Role.ORG_ADMIN, Role.INVESTIGATOR),
  async (req, res, next) => {
    try {
      const request = req as unknown as TenantScopedRequest;
      const [result, reviewHistory, auditHistory] = await Promise.all([
        getVerificationReport(request.orgId, req.params.id),
        getReviewHistory(request.orgId, req.params.id),
        getVerificationAuditHistory(request.orgId, req.params.id),
      ]);
      res.json(buildInvestigationView({ ...result, submittedByName: result.submittedBy.name }, reviewHistory, auditHistory));
    } catch (err) {
      next(err);
    }
  },
);
