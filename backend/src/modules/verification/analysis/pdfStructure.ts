import { loadPdfDocument, loadPdfjsLib } from "../pdfjs.js";
import { finding, type Finding } from "../finding.js";

const MODULE = "pdfStructure";
const DIMENSION_TOLERANCE_PT = 2;

// Font-consistency thresholds (spec's own example: 20 amounts in one font,
// one in another). Deliberately conservative: only fires when there's
// enough text for "minority" to be meaningful, and only when one font
// clearly dominates — a 3-font document where each is used ~a third of the
// time is normal (headers/body/footer), not an anomaly.
const MIN_TOTAL_SPANS_FOR_FONT_CHECK = 5;
const DOMINANT_FONT_SHARE_THRESHOLD = 0.7;
// Ratio-based, not an absolute span count: a single short run of "minority"
// text can still land as several pdfjs text items (word/kerning-driven
// splits vary by PDF producer), so a fixed count like "≤2 items" is
// fragile. A share of total spans is robust to that variance.
const MINORITY_FONT_MAX_SHARE = 0.2;

// Heuristic, not a full xref-chain parse (spec's own caveat applies —
// confidence reflects that). PDFs with incremental updates append
// additional `%%EOF`/trailer/startxref blocks rather than rewriting the
// file, so counting line-anchored `%%EOF` occurrences approximates revision
// count. Line-anchoring (vs. a bare substring search) reduces — but doesn't
// eliminate — false hits from the same byte sequence coincidentally
// appearing inside compressed stream data.
export function countPdfRevisions(buffer: Buffer): number {
  const text = buffer.toString("latin1");
  const matches = text.match(/(?:^|\r?\n)%%EOF/g);
  return matches ? matches.length : 0;
}

export interface PdfStructureResult {
  readable: boolean;
  pageCount: number | null;
  findings: Finding[];
  metadata: { producer: string | null; creator: string | null } | null;
}

// Layer 2 (spec §8). Increment 3: shifted from "what does this PDF look
// like" to "how was this PDF constructed and subsequently modified" —
// metadata, page-dimension consistency, font consistency, annotations,
// embedded files/JS, forms, and incremental-revision evidence. Deep
// object-graph/xref-table introspection (which object changed within a
// revision, not just that a revision happened) is a later increment — it
// needs a lower-level PDF parser than pdfjs-dist's document API exposes
// cleanly (see the Increment 3 plan's library research).
export async function analyzePdfStructure(buffer: Buffer): Promise<PdfStructureResult> {
  let doc;
  try {
    doc = await loadPdfDocument(buffer);
  } catch (err) {
    return {
      readable: false,
      pageCount: null,
      metadata: null,
      findings: [
        finding({
          category: "PDF_STRUCTURE",
          severity: "HIGH",
          confidence: null,
          description: "The PDF could not be parsed — it may be corrupted or malformed.",
          evidence: { error: err instanceof Error ? err.message : String(err) },
          page: null,
          regions: null,
          module: MODULE,
        }),
      ],
    };
  }

  const findings: Finding[] = [];

  try {
    const { PDFDateString } = await loadPdfjsLib();
    const meta = await doc.getMetadata();
    const info = meta.info as Record<string, unknown>;
    const producer = typeof info.Producer === "string" ? info.Producer : null;
    const creator = typeof info.Creator === "string" ? info.Creator : null;
    const creationDateRaw = typeof info.CreationDate === "string" ? info.CreationDate : null;
    const modificationDateRaw = typeof info.ModDate === "string" ? info.ModDate : null;

    findings.push(
      finding({
        category: "PDF_STRUCTURE",
        severity: "INFO",
        confidence: null,
        description: "PDF document metadata.",
        evidence: {
          pdfVersion: info.PDFFormatVersion ?? null,
          producer,
          creator,
          creationDate: creationDateRaw,
          modificationDate: modificationDateRaw,
        },
        page: null,
        regions: null,
        module: MODULE,
      }),
    );

    // --- Page dimensions + font consistency (one pass over each page) ---
    const dimensions: Array<{ page: number; width: number; height: number }> = [];
    const fontStats = new Map<string, { count: number; sample: string; pages: Set<number> }>();
    let totalSpans = 0;
    const annotationCounts = new Map<string, number>();

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      dimensions.push({ page: pageNumber, width: Math.round(viewport.width), height: Math.round(viewport.height) });

      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item) || !("fontName" in item)) continue;
        const text = (item as { str: string }).str;
        if (text.trim().length === 0) continue;
        // fontName is pdfjs's internal per-page resource id (e.g. "g_d0_f1"),
        // not a human-readable name — content.styles maps it to the actual
        // font family, which is what evidence/descriptions should show.
        const resourceId = (item as { fontName: string }).fontName;
        const fontFamily = content.styles[resourceId]?.fontFamily ?? resourceId;
        totalSpans++;
        const stat = fontStats.get(fontFamily) ?? { count: 0, sample: text.trim(), pages: new Set<number>() };
        stat.count++;
        stat.pages.add(pageNumber);
        fontStats.set(fontFamily, stat);
      }

      const annotations = await page.getAnnotations();
      for (const annotation of annotations as Array<{ subtype?: string }>) {
        const subtype = annotation.subtype ?? "Unknown";
        annotationCounts.set(subtype, (annotationCounts.get(subtype) ?? 0) + 1);
      }
    }

    const [first, ...rest] = dimensions;
    const inconsistentDimensions = first
      ? rest.filter(
          (d) =>
            Math.abs(d.width - first.width) > DIMENSION_TOLERANCE_PT ||
            Math.abs(d.height - first.height) > DIMENSION_TOLERANCE_PT,
        )
      : [];

    if (inconsistentDimensions.length > 0) {
      findings.push(
        finding({
          category: "PDF_STRUCTURE",
          severity: "MEDIUM",
          confidence: null,
          description:
            "Page dimensions are inconsistent across the document — pages may have been sourced from different documents.",
          evidence: { firstPage: first, inconsistentPages: inconsistentDimensions },
          page: null,
          regions: null,
          module: MODULE,
        }),
      );
    }

    if (totalSpans >= MIN_TOTAL_SPANS_FOR_FONT_CHECK) {
      const sorted = [...fontStats.entries()].sort((a, b) => b[1].count - a[1].count);
      const [dominantFont, dominantStat] = sorted[0];
      if (dominantStat.count / totalSpans >= DOMINANT_FONT_SHARE_THRESHOLD) {
        const minorityFonts = sorted
          .slice(1)
          .filter(([, stat]) => stat.count / totalSpans <= MINORITY_FONT_MAX_SHARE)
          .map(([fontName, stat]) => ({
            fontName,
            spanCount: stat.count,
            sampleText: stat.sample,
            pages: [...stat.pages],
          }));

        if (minorityFonts.length > 0) {
          findings.push(
            finding({
              category: "PDF_STRUCTURE",
              severity: "MEDIUM",
              confidence: 0.6,
              description:
                "One or more text spans use a font that differs from the font used throughout the rest of the document.",
              evidence: { dominantFont, dominantSpanCount: dominantStat.count, minorityFonts, totalSpans },
              page: minorityFonts[0].pages[0] ?? null,
              regions: null,
              module: MODULE,
            }),
          );
        }
      }
    }

    if (annotationCounts.size > 0) {
      const fileAttachmentCount = annotationCounts.get("FileAttachment") ?? 0;
      findings.push(
        finding({
          category: "PDF_STRUCTURE",
          severity: fileAttachmentCount > 0 ? "MEDIUM" : "INFO",
          confidence: null,
          description:
            fileAttachmentCount > 0
              ? "The document contains file(s) attached via annotations, not just visible content."
              : "The document contains annotations.",
          evidence: { annotationTypes: Object.fromEntries(annotationCounts) },
          page: null,
          regions: null,
          module: MODULE,
        }),
      );
    }

    // --- Document-level structural facts ---
    const attachments = await doc.getAttachments();
    if (attachments && Object.keys(attachments).length > 0) {
      findings.push(
        finding({
          category: "PDF_STRUCTURE",
          severity: "MEDIUM",
          confidence: null,
          description: "The document has embedded file attachments.",
          evidence: { filenames: Object.keys(attachments) },
          page: null,
          regions: null,
          module: MODULE,
        }),
      );
    }

    const jsActions = await doc.getJSActions();
    if (jsActions && Object.keys(jsActions).length > 0) {
      findings.push(
        finding({
          category: "PDF_STRUCTURE",
          severity: "HIGH",
          confidence: null,
          description:
            "The document contains embedded JavaScript. This is highly unusual for a static document (certificate, invoice, contract, ID) and is both a manipulation vector and a potential security risk.",
          evidence: { triggers: Object.keys(jsActions) },
          page: null,
          regions: null,
          module: MODULE,
        }),
      );
    }

    const fieldObjects = await doc.getFieldObjects();
    if ((fieldObjects && Object.keys(fieldObjects).length > 0) || doc.isPureXfa) {
      findings.push(
        finding({
          category: "PDF_STRUCTURE",
          severity: "INFO",
          confidence: null,
          description: "The document contains form fields.",
          evidence: { fieldCount: fieldObjects ? Object.keys(fieldObjects).length : null, isPureXfa: doc.isPureXfa },
          page: null,
          regions: null,
          module: MODULE,
        }),
      );
    }

    // --- Incremental-update/revision evidence + metadata cross-check ---
    const revisionCount = countPdfRevisions(buffer);
    if (revisionCount > 1) {
      findings.push(
        finding({
          category: "PDF_STRUCTURE",
          severity: "MEDIUM",
          confidence: 0.7,
          description: `The file shows structural evidence of ${revisionCount - 1} incremental revision(s) after its initial creation. This is not inherently suspicious (digital signatures and form-field edits commonly append a revision) but is worth knowing.`,
          evidence: {
            revisionCount,
            note: "Detected via a line-anchored %%EOF byte scan, not a full xref-chain parse — an approximation, not a certainty.",
          },
          page: null,
          regions: null,
          module: MODULE,
        }),
      );
    }

    if (modificationDateRaw && revisionCount <= 1) {
      findings.push(
        finding({
          category: "PDF_STRUCTURE",
          severity: "HIGH",
          confidence: 0.6,
          description:
            "The document's metadata records a modification date, but the file shows no structural evidence of ever being revised after creation.",
          evidence: { modificationDate: modificationDateRaw, revisionCount },
          page: null,
          regions: null,
          module: MODULE,
        }),
      );
    } else if (!modificationDateRaw && revisionCount > 1) {
      findings.push(
        finding({
          category: "PDF_STRUCTURE",
          severity: "MEDIUM",
          confidence: 0.6,
          description:
            "The file shows structural evidence of being revised after creation, but its metadata does not record a modification date.",
          evidence: { revisionCount },
          page: null,
          regions: null,
          module: MODULE,
        }),
      );
    }

    if (creationDateRaw && modificationDateRaw) {
      const created = PDFDateString.toDateObject(creationDateRaw);
      const modified = PDFDateString.toDateObject(modificationDateRaw);
      if (created && modified && modified.getTime() < created.getTime()) {
        findings.push(
          finding({
            category: "PDF_STRUCTURE",
            severity: "MEDIUM",
            confidence: null,
            description: "The document's modification date is earlier than its creation date.",
            evidence: { creationDate: creationDateRaw, modificationDate: modificationDateRaw },
            page: null,
            regions: null,
            module: MODULE,
          }),
        );
      }
    }

    return { readable: true, pageCount: doc.numPages, metadata: { producer, creator }, findings };
  } catch (err) {
    return {
      readable: false,
      pageCount: null,
      metadata: null,
      findings: [
        finding({
          category: "PDF_STRUCTURE",
          severity: "HIGH",
          confidence: null,
          description: "The PDF could be opened but not fully read — it may be malformed.",
          evidence: { error: err instanceof Error ? err.message : String(err) },
          page: null,
          regions: null,
          module: MODULE,
        }),
      ],
    };
  } finally {
    await doc.destroy();
  }
}
