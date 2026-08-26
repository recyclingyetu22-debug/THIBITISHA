import { Router } from "express";
import { Role } from "@prisma/client";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { attachTenant, type TenantScopedRequest } from "../../middleware/tenant.js";
import { upload } from "../../middleware/upload.js";
import { HttpError } from "../../middleware/errorHandler.js";
import { registerDocumentSchema } from "./documents.schemas.js";
import {
  getDocument,
  getDocumentFileForDownload,
  listDocuments,
  registerDocument,
} from "./documents.service.js";

export const documentsRouter = Router();

documentsRouter.use(requireAuth, attachTenant);

documentsRouter.post(
  "/",
  requireRole(Role.ORG_ADMIN, Role.DOCUMENT_OFFICER),
  upload.single("file"),
  async (req, res, next) => {
    try {
      const request = req as unknown as TenantScopedRequest;
      if (!req.file) {
        throw new HttpError(400, "A file is required");
      }
      const input = registerDocumentSchema.parse(req.body);
      const { document, version } = await registerDocument(request.orgId, request.auth!.sub, input, {
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
        originalname: req.file.originalname,
      });
      res.status(201).json({
        id: document.id,
        documentNumber: document.documentNumber,
        documentType: document.documentType,
        title: document.title,
        classification: document.classification,
        version: { versionNumber: version.versionNumber, sha256: version.sha256, sizeBytes: version.sizeBytes },
      });
    } catch (err) {
      next(err);
    }
  },
);

documentsRouter.get("/", async (req, res, next) => {
  try {
    const request = req as unknown as TenantScopedRequest;
    const documents = await listDocuments(request.orgId);
    res.json(
      documents.map((d) => ({
        id: d.id,
        documentNumber: d.documentNumber,
        documentType: d.documentType,
        title: d.title,
        classification: d.classification,
        status: d.status,
        currentVersion: d.currentVersion
          ? { versionNumber: d.currentVersion.versionNumber, sha256: d.currentVersion.sha256 }
          : null,
        createdAt: d.createdAt,
      })),
    );
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/:id", async (req, res, next) => {
  try {
    const request = req as unknown as TenantScopedRequest;
    const document = await getDocument(request.orgId, req.params.id);
    res.json({
      id: document.id,
      documentNumber: document.documentNumber,
      documentType: document.documentType,
      title: document.title,
      issuer: document.issuer,
      ownerName: document.ownerName,
      classification: document.classification,
      status: document.status,
      currentVersion: document.currentVersion
        ? {
            versionNumber: document.currentVersion.versionNumber,
            sha256: document.currentVersion.sha256,
            mimeType: document.currentVersion.mimeType,
            sizeBytes: document.currentVersion.sizeBytes,
            createdAt: document.currentVersion.createdAt,
          }
        : null,
      versionCount: document.versions.length,
      createdAt: document.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/:id/download", async (req, res, next) => {
  try {
    const request = req as unknown as TenantScopedRequest;
    const { buffer, mimeType, filename } = await getDocumentFileForDownload(request.orgId, req.params.id);
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});
