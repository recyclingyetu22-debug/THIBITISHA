import { prisma } from "../../db/client.js";
import { HttpError } from "../../middleware/errorHandler.js";
import { storageProvider } from "../storage/localDiskProvider.js";
import { rasterizePdfPages } from "./pdfRasterizer.js";

export interface PageImageResult {
  buffer: Buffer;
  mimeType: string;
}

// Existing rasterization capability (pdfRasterizer.ts, built for the OCR
// fallback path in Increment 2), exposed via an endpoint for the first time
// — not a new detector. The returned PNG's pixel space is exactly what
// every finding's `regions` are already expressed in (RASTERIZE_SCALE), so
// a UI can overlay region highlights with zero coordinate transformation.
export async function getVerificationPageImage(
  organizationId: string,
  verificationRequestId: string,
  pageNumber: number,
): Promise<PageImageResult> {
  const verificationRequest = await prisma.verificationRequest.findFirst({
    where: { id: verificationRequestId, organizationId },
  });
  if (!verificationRequest) {
    throw new HttpError(404, "Verification not found");
  }
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new HttpError(400, "Page number must be a positive integer");
  }

  const fileBuffer = await storageProvider.get(verificationRequest.storageKey);

  if (verificationRequest.mimeType !== "application/pdf") {
    if (pageNumber !== 1) {
      throw new HttpError(404, "This document has only one page");
    }
    return { buffer: fileBuffer, mimeType: verificationRequest.mimeType };
  }

  const rasterized = await rasterizePdfPages(fileBuffer, pageNumber);
  if (pageNumber > rasterized.totalPageCount) {
    throw new HttpError(404, `This document only has ${rasterized.totalPageCount} page(s)`);
  }

  const pageImage = rasterized.pageImages[pageNumber - 1];
  if (!pageImage) {
    // The page exists (per totalPageCount) but fell outside the
    // rasterizer's own analysis cap — same coverage-limit concept as
    // orchestrator.ts's ANALYSIS_LIMIT_REACHED finding, surfaced here as an
    // explicit error rather than silently returning nothing.
    throw new HttpError(422, "This page could not be rendered — it exceeds the analysis page limit");
  }

  return { buffer: pageImage, mimeType: "image/png" };
}
