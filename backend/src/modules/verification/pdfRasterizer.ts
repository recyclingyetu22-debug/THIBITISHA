import { PDFiumLibrary, type PDFiumPageRenderOptions } from "@hyzyla/pdfium";
import sharp from "sharp";

// WASM engine, MIT-licensed, zero native deps (PDFium itself is BSD-3-Clause)
// — chosen over @napi-rs/canvas (reproducibly broken pairing with
// pdfjs-dist's page.render() on this stack) and mupdf (AGPL-3.0, a
// commercial-licensing blocker). See the Increment 2 plan for the empirical
// evaluation. WASM init is real cost, so the library instance is created
// once and reused for the process lifetime, not per request.
let libraryPromise: Promise<PDFiumLibrary> | null = null;
function getLibrary(): Promise<PDFiumLibrary> {
  if (!libraryPromise) {
    libraryPromise = PDFiumLibrary.init();
  }
  return libraryPromise;
}

async function renderToPng(options: PDFiumPageRenderOptions): Promise<Buffer> {
  return sharp(options.data, { raw: { width: options.width, height: options.height, channels: 4 } })
    .png()
    .toBuffer();
}

// Exported so callers that need to map a PDF-point-space rect (e.g. an
// image placement recovered from the operator list, regionForensics.ts)
// onto this module's rasterized pixel space can do so consistently, rather
// than duplicating/hardcoding the scale elsewhere.
export const RASTERIZE_SCALE = 2; // ~144 DPI equivalent — enough detail for OCR without excessive memory/time
const PAGE_BATCH_SIZE = 10; // pages rendered concurrently per batch — bounds peak memory regardless of document length
const DEFAULT_MAX_PAGES_TO_ANALYZE = 50; // covers the large majority of real-world contracts/statements/reports

export interface RasterizationResult {
  pageImages: Buffer[];
  totalPageCount: number;
  analyzedPageCount: number;
  // True whenever analyzedPageCount < totalPageCount, for ANY reason (the
  // page cap today; a future time budget would set this the same way). The
  // caller MUST surface this — never let a partial rasterization pass
  // through the assessment pipeline as if it were complete coverage (see
  // orchestrator.ts / assessment.ts).
  coverageIncomplete: boolean;
}

// Renders pages in batches of PAGE_BATCH_SIZE, not all at once — a 300-page
// PDF never holds 300 rasterized bitmaps in memory simultaneously, only one
// batch's worth. `maxPages` is a parameter (not just a module constant) so
// tests can exercise the incomplete-coverage path with a small fixture
// instead of needing a genuinely 50+ page PDF.
export async function rasterizePdfPages(
  buffer: Buffer,
  maxPages: number = DEFAULT_MAX_PAGES_TO_ANALYZE,
): Promise<RasterizationResult> {
  const library = await getLibrary();
  const document = await library.loadDocument(buffer);
  try {
    const totalPageCount = document.getPageCount();
    const pagesToAnalyze = Math.min(totalPageCount, maxPages);
    const pageImages: Buffer[] = [];

    for (let batchStart = 0; batchStart < pagesToAnalyze; batchStart += PAGE_BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + PAGE_BATCH_SIZE, pagesToAnalyze);
      const batch: Promise<Buffer>[] = [];
      for (let pageIndex = batchStart; pageIndex < batchEnd; pageIndex++) {
        const page = document.getPage(pageIndex);
        batch.push(page.render({ scale: RASTERIZE_SCALE, render: renderToPng }).then((img) => Buffer.from(img.data)));
      }
      pageImages.push(...(await Promise.all(batch)));
    }

    return {
      pageImages,
      totalPageCount,
      analyzedPageCount: pageImages.length,
      coverageIncomplete: pageImages.length < totalPageCount,
    };
  } finally {
    document.destroy();
  }
}
