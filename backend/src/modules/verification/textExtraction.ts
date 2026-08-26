import { createWorker } from "tesseract.js";
import type { TextExtractionMethod } from "@prisma/client";
import { loadPdfDocument } from "./pdfjs.js";
import { rasterizePdfPages } from "./pdfRasterizer.js";
import { prisma } from "../../db/client.js";

export class PdfTextUnavailableError extends Error {}

export interface ExtractedText {
  text: string;
  // Total pages in the document — ALWAYS the true total, never just "pages
  // we happened to process." Coverage gaps are tracked separately below so
  // they can never be silently conflated with "fully analyzed."
  pageCount: number;
  // Pages actually read. Equal to pageCount for DIRECT extraction (pdfjs's
  // getTextContent() is cheap enough to never need a cap) and for single-
  // page OCR images. Can be less than pageCount for the OCR-on-rasterized-
  // pages fallback, if the document exceeds the analysis cap.
  analyzedPageCount: number;
  method: TextExtractionMethod;
}

async function directPdfText(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  const doc = await loadPdfDocument(buffer);
  try {
    const pageTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      pageTexts.push(pageText);
    }
    return { text: pageTexts.join("\n\n"), pageCount: doc.numPages };
  } finally {
    await doc.destroy();
  }
}

// One shared worker for every page of a document, not one per page — worker
// creation (WASM init + language data) is the expensive part, not the
// per-page recognition itself.
async function ocrPages(pageImages: Buffer[]): Promise<string> {
  const worker = await createWorker("eng");
  try {
    const pageTexts: string[] = [];
    for (const image of pageImages) {
      const { data } = await worker.recognize(image);
      pageTexts.push(data.text);
    }
    return pageTexts.join("\n\n");
  } finally {
    await worker.terminate();
  }
}

async function ocrImage(buffer: Buffer): Promise<ExtractedText> {
  const text = await ocrPages([buffer]);
  return { text, pageCount: 1, analyzedPageCount: 1, method: "OCR" };
}

// PDFs: read the embedded text layer directly first (cheap, exact — always
// covers every page, no cap needed). Only when that's empty — a scanned PDF
// with no text layer — rasterize pages (pdfRasterizer.ts, batched, capped)
// and OCR each one. If the document still yields nothing after that (a
// blank or too-poor-quality scan), this throws rather than silently
// returning empty text, so the caller can distinguish "genuinely nothing to
// extract" from "found nothing, must be a blank field" — the orchestrator
// maps this to INCONCLUSIVE, not a false LOW_CONCERN.
async function extractPdfText(buffer: Buffer, maxPages?: number): Promise<ExtractedText> {
  const direct = await directPdfText(buffer);
  if (direct.text.trim().length > 0) {
    return { text: direct.text, pageCount: direct.pageCount, analyzedPageCount: direct.pageCount, method: "DIRECT" };
  }

  const rasterized = await rasterizePdfPages(buffer, maxPages);
  const ocrText = await ocrPages(rasterized.pageImages);
  if (ocrText.trim().length === 0) {
    throw new PdfTextUnavailableError(
      "No extractable text found in this PDF, even after OCR on its rendered pages.",
    );
  }
  return {
    text: ocrText,
    pageCount: rasterized.totalPageCount,
    analyzedPageCount: rasterized.analyzedPageCount,
    method: "OCR",
  };
}

export async function extractText(buffer: Buffer, mimeType: string, maxPages?: number): Promise<ExtractedText> {
  if (mimeType === "application/pdf") {
    return extractPdfText(buffer, maxPages);
  }
  return ocrImage(buffer);
}

// Cache wrapper, keyed by content hash (see schema comment on DocumentText)
// — shared by both the optional reference document and the submitted file,
// so OCR (the expensive step) is never repeated for identical bytes.
export async function getOrExtractText(sha256: string, buffer: Buffer, mimeType: string): Promise<ExtractedText> {
  const cached = await prisma.documentText.findUnique({ where: { sha256 } });
  if (cached) {
    return {
      text: cached.text,
      pageCount: cached.pageCount,
      analyzedPageCount: cached.analyzedPageCount,
      method: cached.extractionMethod,
    };
  }

  const extracted = await extractText(buffer, mimeType);
  await prisma.documentText.create({
    data: {
      sha256,
      extractionMethod: extracted.method,
      text: extracted.text,
      pageCount: extracted.pageCount,
      analyzedPageCount: extracted.analyzedPageCount,
    },
  });
  return extracted;
}
