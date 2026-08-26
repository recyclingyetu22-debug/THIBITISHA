import sharp from "sharp";
import { loadPdfDocument, loadPdfjsLib } from "../pdfjs.js";
import { rasterizePdfPages, RASTERIZE_SCALE } from "../pdfRasterizer.js";
import { finding, type Finding, type PixelRect } from "../finding.js";

const MODULE_BOUNDARY = "regionForensics:boundary";

// A candidate region covering more than this share of the page is "the
// whole page is one scan," not a localized graphic — this is the one rule
// that makes a single algorithm handle both "text PDF with an embedded
// logo/signature" and "scanned PDF" without a separate code path for either
// (see the Increment 6 plan).
const MAX_IMAGE_REGION_PAGE_AREA_SHARE = 0.4;
const MIN_REGION_DIMENSION_PT = 20; // ignore tiny/degenerate embedded images (icons, bullets, rule lines)
// Fallback tiling — coarser than imageForensics.ts's 16px copy-move blocks
// on purpose (structural/boundary check, not fine-grained pixel matching).
// Named limitation: this only examines the *grid's own* cell boundaries, so
// it can only catch a pasted/composited region whose edges happen to fall
// near a grid line — an arbitrary sub-region positioned entirely within one
// cell's interior is invisible to this check. Real localization (as precise
// as the PDF path's embedded-image-XObject discovery) needs an actual
// object-detection step, out of scope here (no viable dependency — see the
// Increment 6 plan's library research).
const GRID_SIZE = 3;

const BORDER_SAMPLE_STRIDE = 2;
const BACKGROUND_SAMPLE_STRIDE = 20;
const BOUNDARY_MODIFIED_Z_THRESHOLD = 3.5; // same standard threshold as typography.ts's spacing check
const BOUNDARY_ABSOLUTE_FLOOR = 20; // out of a ~360 max gradient magnitude — floor so a flat/clean page's trivial noise isn't read as an outlier
const REGION_MARGIN_FOR_BACKGROUND_EXCLUSION = 6; // px, keeps a region's own edge out of the "background" sample that it's compared against

type RegionSource = "embedded-image" | "signature-field" | "grid-cell";

interface CandidateRegion {
  page: number | null; // null for standalone images
  rect: PixelRect; // always pixel-space of whatever raster buffer accompanies it
  source: RegionSource;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ============================================================================
// Boundary/edge-anomaly check — shared by both PDF regions and standalone-
// image grid cells. An unnaturally sharp, spatially-consistent transition
// exactly along a rectangular boundary (vs. the irregular edges natural
// content has) is the signal — content composited/pasted onto a page
// commonly leaves a harder edge than genuinely-rendered/photographed
// content blended into its surroundings.
// ============================================================================

function gradientMagnitudeAt(data: Buffer, width: number, height: number, x: number, y: number): number {
  const xm = Math.max(0, x - 1);
  const xp = Math.min(width - 1, x + 1);
  const ym = Math.max(0, y - 1);
  const yp = Math.min(height - 1, y + 1);
  const gx = data[y * width + xp] - data[y * width + xm];
  const gy = data[yp * width + x] - data[ym * width + x];
  return Math.sqrt(gx * gx + gy * gy);
}

function isInsideAnyRegion(x: number, y: number, regions: PixelRect[], margin: number): boolean {
  return regions.some(
    (r) => x >= r.x - margin && x < r.x + r.width + margin && y >= r.y - margin && y < r.y + r.height + margin,
  );
}

function computeBackgroundGradientStats(
  data: Buffer,
  width: number,
  height: number,
  excludeRegions: PixelRect[],
): { median: number; mad: number } {
  const samples: number[] = [];
  for (let y = 0; y < height; y += BACKGROUND_SAMPLE_STRIDE) {
    for (let x = 0; x < width; x += BACKGROUND_SAMPLE_STRIDE) {
      if (isInsideAnyRegion(x, y, excludeRegions, REGION_MARGIN_FOR_BACKGROUND_EXCLUSION)) continue;
      samples.push(gradientMagnitudeAt(data, width, height, x, y));
    }
  }
  const med = median(samples);
  const mad = median(samples.map((s) => Math.abs(s - med)));
  return { median: med, mad };
}

function borderGradientMedian(data: Buffer, width: number, height: number, rect: PixelRect): number {
  const samples: number[] = [];
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(width - 1, rect.x + rect.width);
  const y1 = Math.min(height - 1, rect.y + rect.height);

  for (let x = x0; x <= x1; x += BORDER_SAMPLE_STRIDE) {
    samples.push(gradientMagnitudeAt(data, width, height, x, y0));
    samples.push(gradientMagnitudeAt(data, width, height, x, y1));
  }
  for (let y = y0; y <= y1; y += BORDER_SAMPLE_STRIDE) {
    samples.push(gradientMagnitudeAt(data, width, height, x0, y));
    samples.push(gradientMagnitudeAt(data, width, height, x1, y));
  }
  return median(samples);
}

function checkRegionBoundaries(
  data: Buffer,
  width: number,
  height: number,
  regions: CandidateRegion[],
): Finding[] {
  if (regions.length === 0) return [];

  const findings: Finding[] = [];
  for (const region of regions) {
    // Background is computed per-region (excluding just this region), not
    // once globally excluding every candidate — critical for grid-tiling
    // (imageForensics's coarse fallback), where cells collectively tile
    // 100% of the image with zero gaps: excluding *all* regions at once
    // would leave no background to sample at all, and every genuine image
    // would false-positive (caught by the "genuine image, no findings"
    // regression test). Excluding only the region under test leaves the
    // other cells as a legitimate background reference, which is also more
    // correct for the sparse PDF-region case.
    const background = computeBackgroundGradientStats(data, width, height, [region.rect]);
    const borderMedian = borderGradientMedian(data, width, height, region.rect);
    const deviation = borderMedian - background.median; // one-sided: we're looking for *sharper* borders than background, not softer
    if (deviation <= BOUNDARY_ABSOLUTE_FLOOR) continue;
    const isOutlier =
      background.mad > 0.5 ? (0.6745 * deviation) / background.mad > BOUNDARY_MODIFIED_Z_THRESHOLD : true;
    if (!isOutlier) continue;

    findings.push(
      finding({
        category: "REGION_FORENSICS",
        severity: "MEDIUM",
        confidence: 0.45,
        description:
          "This region's boundary shows a sharper, more uniform transition than the surrounding content — a possible indicator that this content was composited or pasted in, rather than part of the originally-rendered/photographed page. Legitimate design elements (boxes, borders, photo frames) can also produce this signal — this is supplementary evidence, not proof.",
        evidence: {
          regionSource: region.source,
          rect: region.rect,
          borderGradientMedian: Math.round(borderMedian * 10) / 10,
          backgroundGradientMedian: Math.round(background.median * 10) / 10,
        },
        page: region.page,
        regions: [region.rect],
        module: MODULE_BOUNDARY,
      }),
    );
  }
  return findings;
}

// ============================================================================
// PDF candidate-region discovery
// ============================================================================

function pdfPointRectToPixelRect(rect: PixelRect): PixelRect {
  return {
    x: Math.round(rect.x * RASTERIZE_SCALE),
    y: Math.round(rect.y * RASTERIZE_SCALE),
    width: Math.round(rect.width * RASTERIZE_SCALE),
    height: Math.round(rect.height * RASTERIZE_SCALE),
  };
}

async function discoverPdfCandidateRegions(
  buffer: Buffer,
): Promise<{ regions: CandidateRegion[]; pagesNeedingGridFallback: Set<number>; pageCount: number }> {
  const pdfjsLib = await loadPdfjsLib();
  const { OPS, Util } = pdfjsLib;
  const doc = await loadPdfDocument(buffer);
  try {
    const regions: CandidateRegion[] = [];
    const pagesNeedingGridFallback = new Set<number>();

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const pageWidth = viewport.width;
      const pageHeight = viewport.height;
      const pageArea = pageWidth * pageHeight;
      const pageRegions: CandidateRegion[] = [];

      // --- embedded image XObjects, located via a CTM-tracked operator-list walk ---
      // Matrix math (Util.transform/getAxialAlignedBoundingBox) and
      // composition order are pdfjs's own — verified against pdfjs's
      // internal CanvasGraphics.transform handling and a real diagnostic
      // run before writing this (see the Increment 6 plan), not assumed.
      const opList = await page.getOperatorList();
      let ctm: number[] = [1, 0, 0, 1, 0, 0];
      const ctmStack: number[][] = [];

      for (let i = 0; i < opList.fnArray.length; i++) {
        const op = opList.fnArray[i];
        if (op === OPS.save) {
          ctmStack.push(ctm);
        } else if (op === OPS.restore) {
          ctm = ctmStack.pop() ?? ctm;
        } else if (op === OPS.transform) {
          const args = opList.argsArray[i] as number[];
          ctm = Util.transform(ctm, args);
        } else if (op === OPS.paintImageXObject || op === OPS.paintImageXObjectRepeat) {
          const [x0, y0, x1, y1] = Util.getAxialAlignedBoundingBox([0, 0, 1, 1], ctm);
          const width = x1 - x0;
          const height = y1 - y0;
          if (width < MIN_REGION_DIMENSION_PT || height < MIN_REGION_DIMENSION_PT) continue;
          if (width * height > pageArea * MAX_IMAGE_REGION_PAGE_AREA_SHARE) continue;
          pageRegions.push({
            page: pageNumber,
            // Flip to top-left-origin pixel convention (PDF user space has
            // origin bottom-left, y increasing upward; the rasterized page
            // this gets compared against has origin top-left, y increasing
            // downward — same convention pdfRasterizer.ts's PNG output uses).
            rect: pdfPointRectToPixelRect({ x: x0, y: pageHeight - y1, width, height }),
            source: "embedded-image",
          });
        }
      }

      // --- signature form-field annotations ---
      const annotations = await page.getAnnotations();
      for (const annotation of annotations as Array<{ subtype?: string; fieldType?: string; rect?: number[] }>) {
        if (annotation.subtype !== "Widget" || annotation.fieldType !== "Sig" || !annotation.rect) continue;
        const [ax0, ay0, ax1, ay1] = annotation.rect;
        const width = Math.abs(ax1 - ax0);
        const height = Math.abs(ay1 - ay0);
        if (width < MIN_REGION_DIMENSION_PT || height < MIN_REGION_DIMENSION_PT) continue;
        pageRegions.push({
          page: pageNumber,
          rect: pdfPointRectToPixelRect({
            x: Math.min(ax0, ax1),
            y: pageHeight - Math.max(ay0, ay1),
            width,
            height,
          }),
          source: "signature-field",
        });
      }

      if (pageRegions.length === 0) {
        pagesNeedingGridFallback.add(pageNumber);
      } else {
        regions.push(...pageRegions);
      }
    }

    return { regions, pagesNeedingGridFallback, pageCount: doc.numPages };
  } finally {
    await doc.destroy();
  }
}

function gridRegionsForPage(pageNumber: number, width: number, height: number): CandidateRegion[] {
  const cellW = Math.floor(width / GRID_SIZE);
  const cellH = Math.floor(height / GRID_SIZE);
  const regions: CandidateRegion[] = [];
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      regions.push({
        page: pageNumber,
        rect: { x: col * cellW, y: row * cellH, width: cellW, height: cellH },
        source: "grid-cell",
      });
    }
  }
  return regions;
}

export async function analyzePdfRegionForensics(buffer: Buffer): Promise<Finding[]> {
  try {
    return await analyzePdfRegionForensicsUnsafe(buffer);
  } catch {
    return [];
  }
}

async function analyzePdfRegionForensicsUnsafe(buffer: Buffer): Promise<Finding[]> {
  const { regions, pagesNeedingGridFallback, pageCount } = await discoverPdfCandidateRegions(buffer);
  if (regions.length === 0 && pagesNeedingGridFallback.size === 0) return [];

  // One rasterization covering every page this increment needs — regions on
  // the same page share it rather than each triggering their own render.
  const rasterized = await rasterizePdfPages(buffer, pageCount);
  const findings: Finding[] = [];

  const regionsByPage = new Map<number, CandidateRegion[]>();
  for (const region of regions) {
    const list = regionsByPage.get(region.page!) ?? [];
    list.push(region);
    regionsByPage.set(region.page!, list);
  }
  for (const pageNumber of pagesNeedingGridFallback) {
    const pageImage = rasterized.pageImages[pageNumber - 1];
    if (!pageImage) continue;
    const metadata = await sharp(pageImage).metadata();
    if (!metadata.width || !metadata.height) continue;
    regionsByPage.set(pageNumber, gridRegionsForPage(pageNumber, metadata.width, metadata.height));
  }

  for (const [pageNumber, pageRegions] of regionsByPage) {
    const pageImage = rasterized.pageImages[pageNumber - 1];
    if (!pageImage) continue;
    const { data, info } = await sharp(pageImage).greyscale().raw().toBuffer({ resolveWithObject: true });
    findings.push(...checkRegionBoundaries(data, info.width, info.height, pageRegions));
  }

  return findings;
}

// ============================================================================
// Standalone-image candidate-region discovery (grid tiling only — no
// object/page structure exists to exploit, per the Increment 6 plan).
// ============================================================================

export async function analyzeImageRegionForensics(buffer: Buffer): Promise<Finding[]> {
  try {
    return await analyzeImageRegionForensicsUnsafe(buffer);
  } catch {
    return [];
  }
}

async function analyzeImageRegionForensicsUnsafe(buffer: Buffer): Promise<Finding[]> {
  const { data, info } = await sharp(buffer).greyscale().raw().toBuffer({ resolveWithObject: true });
  const regions = gridRegionsForPage(1, info.width, info.height).map((r) => ({ ...r, page: null }));
  return checkRegionBoundaries(data, info.width, info.height, regions);
}
