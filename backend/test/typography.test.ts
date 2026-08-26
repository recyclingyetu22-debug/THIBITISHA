import { describe, expect, it } from "vitest";
import { analyzeTypography } from "../src/modules/verification/analysis/typography.js";
import { CORRUPTED_PDF_BYTES, makeImageWithText, makePdfWithPositionedText, makeScannedPdf } from "./fixtures.js";

const BODY_WORDS = ["Alpha", "Bravo", "Charlie", "Delta"];

// Six lines, four consistent 12pt Helvetica words each, uniform 30pt gaps —
// a plain, unremarkable "genuine document" baseline for both checks.
function consistentLines(lineCount = 6, gap = 30, startY = 100) {
  const runs = [];
  for (let line = 0; line < lineCount; line++) {
    const y = startY + line * gap;
    BODY_WORDS.forEach((word, i) => runs.push({ text: word, x: 50 + i * 100, baselineY: y, fontSize: 12 }));
  }
  return runs;
}

describe("typography: per-line font/size consistency", () => {
  it("finds no findings in a genuine document with consistent font and size throughout", async () => {
    const buffer = await makePdfWithPositionedText(consistentLines());
    const findings = await analyzeTypography(buffer);
    expect(findings).toEqual([]);
  });

  it("flags a word rendered at a noticeably different size than the rest of its line", async () => {
    const runs = consistentLines();
    // Line 2 (index 2): bump one word to 20pt among three 12pt siblings.
    const targetLineY = 100 + 2 * 30;
    const deviantIndex = runs.findIndex((r) => r.baselineY === targetLineY && r.text === "Bravo");
    runs[deviantIndex] = { ...runs[deviantIndex], fontSize: 20 };

    const findings = await analyzeTypography(await makePdfWithPositionedText(runs));
    const sizeFinding = findings.find((f) => (f.evidence as { text?: string } | null)?.text === "Bravo");

    expect(sizeFinding).toBeDefined();
    expect(sizeFinding?.category).toBe("TYPOGRAPHY");
    expect(sizeFinding?.severity).toBe("MEDIUM");
    expect(sizeFinding?.page).toBe(1);
    expect((sizeFinding?.evidence as { actualSize: number }).actualSize).toBe(20);
    expect((sizeFinding?.evidence as { lineDominantSize: number }).lineDominantSize).toBe(12);
  });

  it("flags a word rendered in a different font family than the rest of its line", async () => {
    const runs = consistentLines();
    const targetLineY = 100 + 1 * 30;
    const deviantIndex = runs.findIndex((r) => r.baselineY === targetLineY && r.text === "Charlie");
    runs[deviantIndex] = { ...runs[deviantIndex], font: "Courier" };

    const findings = await analyzeTypography(await makePdfWithPositionedText(runs));
    const familyFinding = findings.find((f) => (f.evidence as { text?: string } | null)?.text === "Charlie");

    expect(familyFinding).toBeDefined();
    // pdfjs reports standard PDF fonts by their generic CSS family (e.g.
    // Courier -> "monospace"), not the literal font name — assert the thing
    // that actually matters: it genuinely differs from the line's dominant
    // family (Helvetica -> "sans-serif").
    const evidence = familyFinding?.evidence as { actualFont: string; lineDominantFont: string };
    expect(evidence.actualFont).not.toBe(evidence.lineDominantFont);
    expect(familyFinding?.description).toContain("font");
  });

  it("does not false-positive on a legitimate heading (larger font, its own line) followed by consistent body text", async () => {
    const heading = [{ text: "ANNUAL REPORT", x: 50, baselineY: 60, fontSize: 28 }];
    const body = consistentLines(6, 30, 120);
    const findings = await analyzeTypography(await makePdfWithPositionedText([...heading, ...body]));

    expect(findings.filter((f) => (f.evidence as { text?: string } | null)?.text === "ANNUAL REPORT")).toEqual([]);
  });

  it("does not flag a line with too few spans to establish a dominant style", async () => {
    // Two spans, different sizes, on one line — not enough to say which one
    // is "the" style and which is "deviant" (MIN_SPANS_PER_LINE_FOR_CHECK).
    const runs = [
      { text: "One", x: 50, baselineY: 100, fontSize: 12 },
      { text: "Two", x: 150, baselineY: 100, fontSize: 20 },
    ];
    const findings = await analyzeTypography(await makePdfWithPositionedText(runs));
    expect(findings).toEqual([]);
  });
});

describe("typography: line-spacing consistency", () => {
  it("finds no spacing findings when line spacing is uniform", async () => {
    const buffer = await makePdfWithPositionedText(consistentLines(6, 30));
    const findings = await analyzeTypography(buffer);
    expect(findings.filter((f) => f.module === "typography:lineSpacing")).toEqual([]);
  });

  it("flags an isolated line squeezed much closer to its neighbor than the rest of the page", async () => {
    const runs = [];
    const gaps = [30, 30, 30, 8, 30, 30]; // one compressed gap among uniform 30pt gaps
    let y = 100;
    for (const gap of gaps) {
      BODY_WORDS.forEach((word, i) => runs.push({ text: word, x: 50 + i * 100, baselineY: y, fontSize: 12 }));
      y += gap;
    }
    BODY_WORDS.forEach((word, i) => runs.push({ text: word, x: 50 + i * 100, baselineY: y, fontSize: 12 }));

    const findings = await analyzeTypography(await makePdfWithPositionedText(runs));
    const spacingFindings = findings.filter((f) => f.module === "typography:lineSpacing");

    expect(spacingFindings.length).toBeGreaterThan(0);
    expect(spacingFindings[0].severity).toBe("LOW");
    expect((spacingFindings[0].evidence as { gap: number }).gap).toBeCloseTo(8, 0);
  });
});

describe("typography: robustness", () => {
  it("returns no findings (not an error) for a scanned/image-only PDF with no text layer", async () => {
    const scanned = await makeScannedPdf([await makeImageWithText("SCANNED PAGE")]);
    const findings = await analyzeTypography(scanned);
    expect(findings).toEqual([]);
  });

  it("fails gracefully on a corrupted PDF instead of throwing", async () => {
    const findings = await analyzeTypography(CORRUPTED_PDF_BYTES);
    expect(findings).toEqual([]);
  });
});
