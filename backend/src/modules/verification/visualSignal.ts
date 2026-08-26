import sharp from "sharp";
import { loadPdfDocument } from "./pdfjs.js";
import { rasterizePdfPages } from "./pdfRasterizer.js";

export type VisualSignal =
  | { kind: "image"; differencePixelRatio: number }
  | {
      kind: "pdf";
      pageCountOriginal: number;
      pageCountSubmitted: number;
      pageDimensionsMatch: boolean;
      // Present only when both sides' first page rasterized successfully —
      // rasterization failure here is non-fatal (spec §66), the metadata
      // fields above still carry the comparison.
      firstPageDifferencePixelRatio: number | null;
    };

const THUMBNAIL_SIZE = 32;

// Used only along the optional reference-comparison path (spec §16). Both
// images are normalized to the same small grayscale thumbnail so this is
// resilient to different source resolutions/compression, then compared
// pixel-by-pixel. Also reused for PDFs' rasterized first page — same
// comparison, just fed rendered bitmaps instead of the original image files.
async function differencePixelRatio(originalBuffer: Buffer, submittedBuffer: Buffer): Promise<number> {
  const [a, b] = await Promise.all([
    sharp(originalBuffer).resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "fill" }).grayscale().raw().toBuffer(),
    sharp(submittedBuffer).resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "fill" }).grayscale().raw().toBuffer(),
  ]);

  let differing = 0;
  const threshold = 24; // out of 255
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > threshold) differing++;
  }

  return differing / a.length;
}

async function compareImages(originalBuffer: Buffer, submittedBuffer: Buffer): Promise<VisualSignal> {
  return { kind: "image", differencePixelRatio: await differencePixelRatio(originalBuffer, submittedBuffer) };
}

async function comparePdfPages(originalBuffer: Buffer, submittedBuffer: Buffer): Promise<VisualSignal> {
  async function firstPageInfo(buffer: Buffer) {
    const doc = await loadPdfDocument(buffer);
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const info = { pageCount: doc.numPages, width: Math.round(viewport.width), height: Math.round(viewport.height) };
    await doc.destroy();
    return info;
  }

  const [original, submitted] = await Promise.all([firstPageInfo(originalBuffer), firstPageInfo(submittedBuffer)]);

  // Deliberately first-page-only, not a full multi-page diff — "basic"
  // visual comparison per the Increment 2 plan; full per-page difference
  // maps are real image-forensics territory (a later increment).
  let firstPageDifferencePixelRatio: number | null = null;
  try {
    // maxPages: 1 — this comparison only ever looks at page 1, so there's no
    // reason to rasterize (and pay OCR-adjacent cost for) the rest of either
    // document just to compare a single page.
    const [original, submitted] = await Promise.all([
      rasterizePdfPages(originalBuffer, 1),
      rasterizePdfPages(submittedBuffer, 1),
    ]);
    if (original.pageImages[0] && submitted.pageImages[0]) {
      firstPageDifferencePixelRatio = await differencePixelRatio(original.pageImages[0], submitted.pageImages[0]);
    }
  } catch {
    // Non-fatal — falls back to the metadata-only comparison below.
  }

  return {
    kind: "pdf",
    pageCountOriginal: original.pageCount,
    pageCountSubmitted: submitted.pageCount,
    pageDimensionsMatch: original.width === submitted.width && original.height === submitted.height,
    firstPageDifferencePixelRatio,
  };
}

export async function computeVisualSignal(
  mimeType: string,
  originalBuffer: Buffer,
  submittedBuffer: Buffer,
): Promise<VisualSignal> {
  if (mimeType === "application/pdf") {
    return comparePdfPages(originalBuffer, submittedBuffer);
  }
  return compareImages(originalBuffer, submittedBuffer);
}
