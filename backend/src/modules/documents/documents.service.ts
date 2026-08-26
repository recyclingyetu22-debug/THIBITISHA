import { randomUUID } from "node:crypto";
import { prisma } from "../../db/client.js";
import { HttpError } from "../../middleware/errorHandler.js";
import { sha256Hex } from "../../lib/hash.js";
import { detectFileType, isDeclaredMimeConsistent, isExtensionConsistent } from "../../lib/fileType.js";
import { nextDocumentNumber } from "../../lib/documentNumber.js";
import { storageProvider } from "../storage/localDiskProvider.js";
import { recordAuditEvent } from "../audit/auditLog.js";
import type { registerDocumentSchema } from "./documents.schemas.js";
import type { z } from "zod";

type RegisterDocumentInput = z.infer<typeof registerDocumentSchema>;

interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

export async function registerDocument(
  organizationId: string,
  userId: string,
  input: RegisterDocumentInput,
  file: UploadedFile,
) {
  // Validate the bytes actually are what the client claims (spec §86) —
  // never trust Content-Type or the filename extension alone.
  const detected = detectFileType(file.buffer);
  if (!detected) {
    throw new HttpError(422, "Unsupported or unrecognized file type");
  }
  if (!isDeclaredMimeConsistent(detected, file.mimetype)) {
    throw new HttpError(422, "Declared file type does not match file contents");
  }
  if (!isExtensionConsistent(detected, file.originalname)) {
    throw new HttpError(422, "File extension does not match file contents");
  }

  const sha256 = sha256Hex(file.buffer);
  const storageKey = `${organizationId}/${randomUUID()}-${file.originalname}`;

  // Write bytes to storage before the DB transaction: if this fails, nothing
  // in the DB ever references a missing file. A failure after this point
  // (DB transaction) leaves an orphaned but harmless file on disk instead of
  // a broken document record — the safer failure mode of the two.
  await storageProvider.put(storageKey, file.buffer);

  const result = await prisma.$transaction(async (tx) => {
    const documentNumber = await nextDocumentNumber(tx);

    const document = await tx.document.create({
      data: {
        organizationId,
        documentNumber,
        documentType: input.documentType,
        title: input.title,
        issuer: input.issuer,
        ownerName: input.ownerName,
        classification: input.classification,
        createdById: userId,
      },
    });

    const version = await tx.documentVersion.create({
      data: {
        documentId: document.id,
        versionNumber: 1,
        storageKey,
        mimeType: file.mimetype,
        sizeBytes: file.buffer.length,
        sha256,
        createdById: userId,
      },
    });

    await tx.documentFingerprint.create({
      data: { documentVersionId: version.id, sha256 },
    });

    const updatedDocument = await tx.document.update({
      where: { id: document.id },
      data: { currentVersionId: version.id },
    });

    await recordAuditEvent(tx, {
      organizationId,
      userId,
      action: "document_uploaded",
      entityType: "Document",
      entityId: document.id,
      metadata: { sizeBytes: file.buffer.length, mimeType: file.mimetype },
    });
    await recordAuditEvent(tx, {
      organizationId,
      userId,
      action: "sha256_calculated",
      entityType: "DocumentVersion",
      entityId: version.id,
      metadata: { sha256 },
    });
    await recordAuditEvent(tx, {
      organizationId,
      userId,
      action: "document_registered",
      entityType: "Document",
      entityId: document.id,
      metadata: { documentNumber },
    });

    return { document: updatedDocument, version };
  });

  return result;
}

export async function getDocument(organizationId: string, documentId: string) {
  const document = await prisma.document.findFirst({
    where: { id: documentId, organizationId },
    include: { currentVersion: { include: { fingerprint: true } }, versions: true },
  });
  if (!document) {
    throw new HttpError(404, "Document not found");
  }
  return document;
}

export async function listDocuments(organizationId: string) {
  return prisma.document.findMany({
    where: { organizationId },
    include: { currentVersion: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function getDocumentFileForDownload(organizationId: string, documentId: string) {
  const document = await getDocument(organizationId, documentId);
  if (!document.currentVersion) {
    throw new HttpError(404, "Document has no stored version");
  }
  const buffer = await storageProvider.get(document.currentVersion.storageKey);
  return { buffer, mimeType: document.currentVersion.mimeType, filename: document.documentNumber };
}
