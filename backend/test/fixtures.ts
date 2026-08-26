import PDFDocument from "pdfkit";
import sharp from "sharp";

export function makePdfWithText(paragraphs: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    for (const paragraph of paragraphs) {
      doc.fontSize(14).text(paragraph).moveDown();
    }
    doc.end();
  });
}

// Every paragraph in Helvetica (pdfkit's default) except one deliberately
// switched to Courier — the minority-font-usage fixture for the font
// consistency check (pdfStructure.ts).
export function makePdfWithMinorityFont(paragraphs: string[], minorityText: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.font("Helvetica");
    for (const paragraph of paragraphs) {
      doc.fontSize(14).text(paragraph).moveDown();
    }
    doc.font("Courier").fontSize(14).text(minorityText);
    doc.end();
  });
}

// Valid PDF magic bytes (passes the Layer 1 file-integrity gate) but not a
// real PDF structure underneath — exercises the "opens the gate, fails
// deeper parsing" path that should classify as INCONCLUSIVE, never crash.
export const CORRUPTED_PDF_BYTES = Buffer.from("%PDF-1.4\nthis is not a real pdf body, just garbage%%EOF", "latin1");

export async function makeImageWithText(text: string): Promise<Buffer> {
  const svg = `<svg width="800" height="240" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    <text x="20" y="130" font-size="48" font-family="sans-serif" fill="black">${text}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function makePlainImage(): Promise<Buffer> {
  return sharp({ create: { width: 200, height: 200, channels: 3, background: "#4477aa" } }).png().toBuffer();
}

// Blank white page — no rendered text at all. Used for the "poor/blank
// scanned page" test: OCR should legitimately find nothing here.
export async function makeBlankImage(): Promise<Buffer> {
  return sharp({ create: { width: 800, height: 240, channels: 3, background: "white" } }).png().toBuffer();
}

// Same text as makeImageWithText, plus a large solid block covering a third
// of the page — guarantees a visual difference well past any reasonable
// perceptual-diff threshold, unlike two lines of text on matching white
// backgrounds (which mostly overlap pixel-for-pixel). Used for the visual
// reference-comparison test, which needs an unambiguous difference rather
// than one contingent on exact word lengths/positions.
export async function makeImageWithTextAndBlock(text: string): Promise<Buffer> {
  const svg = `<svg width="800" height="240" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    <text x="20" y="130" font-size="48" font-family="sans-serif" fill="black">${text}</text>
    <rect x="0" y="160" width="800" height="80" fill="black"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// Builds a PDF whose pages are each just an embedded image — no real PDF
// text objects, exactly like a real scanned document. pdfjs's
// getTextContent() legitimately returns nothing for this, which is what
// forces the OCR-fallback path under test.
export function makeScannedPdf(pageImages: Buffer[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    for (const image of pageImages) {
      doc.addPage({ size: [800, 240], margin: 0 });
      doc.image(image, 0, 0, { width: 800, height: 240 });
    }
    doc.end();
  });
}

// Deterministic PRNG (mulberry32) — reproducible "noisy" pixel content.
// Genuine per-pixel high-frequency detail is what makes ELA/copy-move tests
// meaningful: a flat/solid image has no texture for either technique to
// distinguish or match against.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoiseRaw(width: number, height: number, seed: number): Buffer {
  const rand = mulberry32(seed);
  const buf = Buffer.alloc(width * height * 3);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(rand() * 256);
  return buf;
}

// Smooth diagonal gradient — low-frequency content that JPEG compresses
// very cleanly (near-zero recompression error), unlike noise (which is
// inherently high-error under any JPEG recompression, uniformly, and so
// never produces a distinguishable *outlier* region for ELA — every block
// is already "noisy," there's nothing to stand out against). ELA needs a
// clean, low-error baseline for a differently-sourced patch to stand out
// against.
function makeGradientRaw(width: number, height: number): Buffer {
  const buf = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = Math.floor(((x + y) / (width + height)) * 255);
      const idx = (y * width + x) * 3;
      buf[idx] = value;
      buf[idx + 1] = value;
      buf[idx + 2] = value;
    }
  }
  return buf;
}

async function noiseJpeg(width: number, height: number, seed: number, quality: number): Promise<Buffer> {
  return sharp(makeNoiseRaw(width, height, seed), { raw: { width, height, channels: 3 } })
    .jpeg({ quality })
    .toBuffer();
}

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

// A smooth-gradient base JPEG (compresses very cleanly — low, uniform ELA
// baseline) with one region overwritten by noise content pasted in and the
// whole thing re-saved. The patch is inherently harder to compress than the
// smooth background, so it shows elevated recompression error relative to
// the rest of the image — a real, distinguishable ELA outlier, unlike a
// uniformly-noisy image where every block already has high error and
// nothing stands out.
export async function makeSplicedJpeg(): Promise<{ buffer: Buffer; patchRegion: Region }> {
  const width = 320;
  const height = 320;
  const patchSize = 96;
  const patchRegion: Region = { x: 190, y: 190, width: patchSize, height: patchSize };

  const base = await sharp(makeGradientRaw(width, height), { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
  const patch = sharp(makeNoiseRaw(patchSize, patchSize, 2), {
    raw: { width: patchSize, height: patchSize, channels: 3 },
  }).png(); // lossless carrier into the composite step — the JPEG artifacting we want is only the final encode below

  const buffer = await sharp(base)
    .composite([{ input: await patch.toBuffer(), left: patchRegion.x, top: patchRegion.y }])
    .jpeg({ quality: 95 })
    .toBuffer();

  return { buffer, patchRegion };
}

// A noise-textured base JPEG with one region duplicated (composited) to
// another, spatially distant location in the same image — a genuine
// copy-move: the two regions are pixel-identical after the final encode.
export async function makeCloneJpeg(): Promise<{ buffer: Buffer; regionA: Region; regionB: Region }> {
  const width = 320;
  const height = 320;
  const cloneSize = 96;
  const regionA: Region = { x: 16, y: 16, width: cloneSize, height: cloneSize };
  const regionB: Region = { x: 200, y: 200, width: cloneSize, height: cloneSize };

  const base = await noiseJpeg(width, height, 3, 95);
  const clonedContent = await sharp(base)
    .extract({ left: regionA.x, top: regionA.y, width: cloneSize, height: cloneSize })
    .toBuffer();

  const buffer = await sharp(base)
    .composite([{ input: clonedContent, left: regionB.x, top: regionB.y }])
    .jpeg({ quality: 95 })
    .toBuffer();

  return { buffer, regionA, regionB };
}

export async function makeGenuineJpeg(width = 320, height = 320, seed = 7): Promise<Buffer> {
  return noiseJpeg(width, height, seed, 92);
}

export interface TextRun {
  text: string;
  x: number;
  baselineY: number;
  fontSize: number;
  font?: string; // pdfkit standard font name, default "Helvetica"
}

// Absolute-positioned text runs — needed for typography.ts tests, which
// need fine control over exactly which spans land on the same line (and
// exactly how far apart lines are) that flowed paragraph text can't give.
//
// pdfkit's .text(str, x, y) treats y as the TOP of the text box, not the
// baseline — confirmed empirically: two runs at the same y but different
// font sizes land on baselines several points apart in pdfjs's transform[5]
// (a 24pt run's baseline sits ~17pt below a 12pt run's for the same y-top,
// vs pdfStructure.ts/typography.ts's 2pt line-grouping tolerance). Callers
// here specify the baseline they want directly; this converts to the y-top
// pdfkit needs using the active font's real ascender metric (not a
// hardcoded ratio — this needs to hold for both Helvetica and Courier,
// which have different metrics, since the font-mismatch fixture mixes them
// on one line).
// Solid, hard-edged fill (no anti-aliasing/blending) — pasted onto a plain
// white PDF page, its border creates a sharp intensity jump exactly along
// the rectangle boundary. This is the signal regionForensics.ts's boundary
// check exists to catch: a signature/seal/logo/photo composited onto a page
// rather than genuinely part of the rendered content.
async function makeHardEdgeImage(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#202020" } })
    .jpeg({ quality: 95 })
    .toBuffer();
}

// Fades to white at its edges — blends into a plain white PDF page with no
// sharp boundary. The false-positive-avoidance counterpart to
// makeHardEdgeImage: a legitimately soft/blended embedded image (e.g. a
// photo with natural falloff) should not trigger the boundary check.
async function makeSoftEdgeImage(width: number, height: number): Promise<Buffer> {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="g" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#999999"/>
        <stop offset="100%" stop-color="#ffffff"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer();
}

export interface EmbeddedImagePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

function makePdfWithEmbeddedImage(
  image: Buffer,
  placement: EmbeddedImagePlacement,
  pageSize: [number, number] = [612, 792],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: pageSize, margin: 0 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(14).text("Document header text goes here.", 40, 40);
    doc.image(image, placement.x, placement.y, { width: placement.width, height: placement.height });
    doc.fontSize(14).text("Document footer text goes here.", 40, pageSize[1] - 60);
    doc.end();
  });
}

// A small, sharply-bounded embedded image — the regionForensics.ts positive
// case (should produce an "embedded-image" boundary finding).
export async function makePdfWithHardEdgeEmbeddedImage(): Promise<{ buffer: Buffer; placement: EmbeddedImagePlacement }> {
  const placement: EmbeddedImagePlacement = { x: 220, y: 350, width: 120, height: 80 };
  const image = await makeHardEdgeImage(placement.width, placement.height);
  return { buffer: await makePdfWithEmbeddedImage(image, placement), placement };
}

// A small, softly-blended embedded image — the false-positive-avoidance
// counterpart (should produce no boundary finding).
export async function makePdfWithSoftEdgeEmbeddedImage(): Promise<Buffer> {
  const placement: EmbeddedImagePlacement = { x: 220, y: 350, width: 120, height: 80 };
  const image = await makeSoftEdgeImage(placement.width, placement.height);
  return makePdfWithEmbeddedImage(image, placement);
}

// An embedded image covering most of a small page — simulates a scanned
// page (the whole page IS one image) rather than a localized graphic.
// Exercises the >40%-of-page-area exclusion rule.
export async function makePdfWithNearFullPageImage(): Promise<Buffer> {
  const pageSize: [number, number] = [300, 300];
  const placement: EmbeddedImagePlacement = { x: 10, y: 10, width: 280, height: 280 };
  const image = await makeHardEdgeImage(placement.width, placement.height);
  return makePdfWithEmbeddedImage(image, placement, pageSize);
}

// A smooth-gradient base (low, consistent background gradient — same
// rationale as makeSplicedJpeg's use of makeGradientRaw over noise: a sharp
// edge needs a smooth baseline to stand out against, since noise's gradient
// is already chaotically high everywhere and would swamp the signal, both
// in absolute terms and by inflating the background's own MAD enough to
// mask the outlier) with a solid, hard-edged patch pasted onto it with no
// blending — the regionForensics.ts standalone-image positive case.
//
// regionForensics.ts's standalone-image path only examines the 3x3 grid
// cells it tiles the whole image into — it has no way to localize an
// arbitrary sub-region the way the PDF path's embedded-image-XObject
// discovery can. So this patch is deliberately positioned to align with the
// center grid cell of a 320x320 image at GRID_SIZE=3 (cell size
// floor(320/3)=106, center cell = [106,106]-[212,212]) — this is a genuine
// test of the boundary-check mechanism itself, not a claim that the grid
// fallback would catch a patch at an arbitrary, non-grid-aligned position
// (a real, named limitation of the coarse fallback).
export async function makeHardEdgePatchJpeg(): Promise<{ buffer: Buffer; patchRegion: Region }> {
  const width = 320;
  const height = 320;
  const patchRegion: Region = { x: 106, y: 106, width: 106, height: 106 };

  const base = await sharp(makeGradientRaw(width, height), { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 92 })
    .toBuffer();
  const patch = await sharp({
    create: { width: patchRegion.width, height: patchRegion.height, channels: 3, background: "#202020" },
  })
    .png()
    .toBuffer();

  const buffer = await sharp(base)
    .composite([{ input: patch, left: patchRegion.x, top: patchRegion.y }])
    .jpeg({ quality: 92 })
    .toBuffer();

  return { buffer, patchRegion };
}

export function makePdfWithPositionedText(runs: TextRun[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 0, size: [612, 792], autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    for (const run of runs) {
      doc.font(run.font ?? "Helvetica").fontSize(run.fontSize);
      const ascender = (doc as unknown as { _font: { ascender: number } })._font.ascender;
      const topY = run.baselineY - (ascender / 1000) * run.fontSize;
      doc.text(run.text, run.x, topY, { lineBreak: false });
    }
    doc.end();
  });
}
