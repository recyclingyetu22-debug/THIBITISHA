import { loadPdfDocument } from "../pdfjs.js";
import { RASTERIZE_SCALE } from "../pdfRasterizer.js";
import { finding, type Finding, type PixelRect } from "../finding.js";

const MODULE_LINE_CONSISTENCY = "typography:lineConsistency";
const MODULE_LINE_SPACING = "typography:lineSpacing";

const LINE_Y_TOLERANCE_PT = 2;
// A line needs enough spans for "dominant vs. deviant" to be meaningful —
// this is what keeps a normal heading (its own short line, no siblings to
// be inconsistent with) from ever being compared against anything.
const MIN_SPANS_PER_LINE_FOR_CHECK = 3;
const DOMINANT_STYLE_MIN_SHARE = 0.5;
const SIZE_DEVIATION_RELATIVE_THRESHOLD = 0.15;

const MIN_LINES_FOR_SPACING_CHECK = 5;
// Modified Z-score threshold (Iglewicz & Hoaglin) — standard choice for
// this method, not tuned specifically for this codebase.
const SPACING_MODIFIED_Z_SCORE_THRESHOLD = 3.5;
const SPACING_ABSOLUTE_FLOOR_PT = 3; // pt — floor so trivial rounding on a very regular page isn't read as an "outlier"

interface Span {
  str: string;
  fontFamily: string;
  size: number;
  x: number;
  y: number;
  width: number;
}

// PDF user space (origin bottom-left, y increasing upward) -> rasterized
// pixel space (origin top-left, y increasing downward, ×RASTERIZE_SCALE) —
// same convention regionForensics.ts uses, so a typography finding's region
// is directly comparable to an image/region-forensics finding's region on
// the same page (what the evidence-correlation stage needs). `size`
// approximates the glyph's total height (ascent+descent combined, per
// pdfjs's TextItem.height) — an honest approximation of the visual
// bounding box, not an exact one.
function spanToPixelRect(span: Span, pageHeight: number): PixelRect {
  return {
    x: Math.round(span.x * RASTERIZE_SCALE),
    y: Math.round((pageHeight - span.y - span.size) * RASTERIZE_SCALE),
    width: Math.round(span.width * RASTERIZE_SCALE),
    height: Math.round(span.size * RASTERIZE_SCALE),
  };
}

interface Line {
  y: number;
  spans: Span[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Single pass over spans sorted top-to-bottom: a new line starts whenever a
// span's y falls outside tolerance of the *current* line's reference y —
// avoids the transitive-drift bug a naive "find any line within tolerance"
// search would have on a long page.
function groupIntoLines(spans: Span[]): Line[] {
  const sorted = [...spans].sort((a, b) => b.y - a.y);
  const lines: Line[] = [];
  for (const span of sorted) {
    const current = lines[lines.length - 1];
    if (current && Math.abs(current.y - span.y) <= LINE_Y_TOLERANCE_PT) {
      current.spans.push(span);
    } else {
      lines.push({ y: span.y, spans: [span] });
    }
  }
  for (const line of lines) line.spans.sort((a, b) => a.x - b.x);
  return lines;
}

// Local deviation, not document-wide (spec's own example is easy to
// misread as "flag any minority font/size in the document" — that would
// false-positive on every heading/title, which is legitimately a different
// size on its own line with nothing to be "inconsistent" with). Comparing a
// span only against its immediate line-siblings is what makes this safe on
// normal documents while still catching "one word in a different font/size
// dropped into an otherwise-uniform line."
function analyzeLineConsistency(lines: Line[], pageNumber: number, pageHeight: number): Finding[] {
  const findings: Finding[] = [];

  for (const line of lines) {
    if (line.spans.length < MIN_SPANS_PER_LINE_FOR_CHECK) continue;

    const styleCounts = new Map<string, { family: string; size: number; count: number }>();
    for (const span of line.spans) {
      const key = `${span.fontFamily}|${span.size.toFixed(1)}`;
      const entry = styleCounts.get(key) ?? { family: span.fontFamily, size: span.size, count: 0 };
      entry.count++;
      styleCounts.set(key, entry);
    }

    const [dominant] = [...styleCounts.values()].sort((a, b) => b.count - a.count);
    if (dominant.count / line.spans.length < DOMINANT_STYLE_MIN_SHARE) continue; // no clear dominant style on this line — too ambiguous to call anything "deviant"

    for (const span of line.spans) {
      const familyDiffers = span.fontFamily !== dominant.family;
      const sizeDiffers = Math.abs(span.size - dominant.size) / dominant.size > SIZE_DEVIATION_RELATIVE_THRESHOLD;
      if (!familyDiffers && !sizeDiffers) continue;

      const what = [familyDiffers && "font", sizeDiffers && "size"].filter(Boolean).join(" and ");
      findings.push(
        finding({
          category: "TYPOGRAPHY",
          severity: "MEDIUM",
          confidence: 0.55,
          description: `Text "${span.str.trim()}" uses a different ${what} than the rest of the line it appears on.`,
          evidence: {
            text: span.str.trim(),
            actualFont: span.fontFamily,
            actualSize: Math.round(span.size * 10) / 10,
            lineDominantFont: dominant.family,
            lineDominantSize: Math.round(dominant.size * 10) / 10,
          },
          page: pageNumber,
          regions: [spanToPixelRect(span, pageHeight)],
          module: MODULE_LINE_CONSISTENCY,
        }),
      );
    }
  }

  return findings;
}

// Weak signal on its own (page breaks, headings, and deliberate formatting
// all legitimately vary spacing) — kept LOW severity/confidence. An
// isolated squeezed/expanded gap among otherwise-uniform spacing can
// indicate inserted or removed content disrupting the flow.
function analyzeLineSpacing(lines: Line[], pageNumber: number): Finding[] {
  if (lines.length < MIN_LINES_FOR_SPACING_CHECK) return [];

  const gaps: number[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    gaps.push(lines[i].y - lines[i + 1].y);
  }

  // Median + median-absolute-deviation (MAD), not mean/stddev: with only a
  // handful of lines on a page, a single genuine outlier gap drags the mean
  // and inflates the stddev enough to mask its own detection — the exact
  // failure mode a plain stddev threshold has on small samples. Median/MAD
  // barely move when one value is anomalous, which is the whole point.
  const med = median(gaps);
  const mad = median(gaps.map((g) => Math.abs(g - med)));

  const lineText = (line: Line) =>
    line.spans
      .map((s) => s.str)
      .join(" ")
      .trim()
      .slice(0, 80);

  const findings: Finding[] = [];
  for (let i = 0; i < gaps.length; i++) {
    const deviation = Math.abs(gaps[i] - med);
    if (deviation <= SPACING_ABSOLUTE_FLOOR_PT) continue;
    // MAD near zero is the common case (most real pages have very uniform
    // spacing) — the modified Z-score would divide by ~0, so fall back to
    // the absolute floor alone rather than an arbitrary MAD floor.
    const isOutlier =
      mad > 0.5 ? (0.6745 * deviation) / mad > SPACING_MODIFIED_Z_SCORE_THRESHOLD : true;
    if (!isOutlier) continue;

    findings.push(
      finding({
        category: "TYPOGRAPHY",
        severity: "LOW",
        confidence: 0.4,
        description:
          "The spacing between two consecutive lines differs unusually from the rest of the page — possibly indicating inserted or removed content disrupting the normal layout.",
        evidence: {
          gap: Math.round(gaps[i] * 10) / 10,
          typicalGap: Math.round(med * 10) / 10,
          lineAbove: lineText(lines[i]),
          lineBelow: lineText(lines[i + 1]),
        },
        page: pageNumber,
        regions: null,
        module: MODULE_LINE_SPACING,
      }),
    );
  }

  return findings;
}

export async function analyzeTypography(buffer: Buffer): Promise<Finding[]> {
  // Self-contained error handling, same pattern as imageForensics.ts — safe
  // to call directly, never crashes the request on an unreadable/corrupted
  // PDF or one with no usable text layer (a scanned PDF legitimately has no
  // per-span position data to analyze; this returns [] for it, not an error).
  try {
    return await analyzeTypographyUnsafe(buffer);
  } catch {
    return [];
  }
}

async function analyzeTypographyUnsafe(buffer: Buffer): Promise<Finding[]> {
  const doc = await loadPdfDocument(buffer);
  try {
    const findings: Finding[] = [];

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const pageHeight = page.getViewport({ scale: 1 }).height;
      const content = await page.getTextContent();

      const spans: Span[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !("transform" in item) || !("height" in item) || !("fontName" in item)) continue;
        if (item.str.trim().length === 0) continue;
        const fontFamily = content.styles[item.fontName]?.fontFamily ?? item.fontName;
        spans.push({
          str: item.str,
          fontFamily,
          size: item.height,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
        });
      }

      if (spans.length === 0) continue;
      const lines = groupIntoLines(spans);
      findings.push(...analyzeLineConsistency(lines, pageNumber, pageHeight));
      findings.push(...analyzeLineSpacing(lines, pageNumber));
    }

    return findings;
  } finally {
    await doc.destroy();
  }
}
