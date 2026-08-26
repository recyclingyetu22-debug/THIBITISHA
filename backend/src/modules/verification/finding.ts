import type { FindingCategory, FindingSeverity } from "@prisma/client";

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The shape every analysis module returns — never a single fake/real flag
// (spec §17). `module` identifies which analyzer produced it so findings
// stay traceable as more analyzers are added in later increments.
export interface Finding {
  category: FindingCategory;
  severity: FindingSeverity;
  confidence: number | null;
  description: string;
  evidence: Record<string, unknown> | null;
  page: number | null;
  // Normalized spatial data, distinct from the free-form `evidence` blob —
  // this is what the evidence-correlation stage (correlation.ts) compares
  // across findings from different detectors. Coordinate space is always
  // "rasterized pixel space for this page/image" (×RASTERIZE_SCALE for PDF
  // pages), never raw PDF point space, so regions from different detectors
  // on the same page are directly comparable. null for findings that
  // genuinely have no spatial locality (metadata, text-content-only
  // findings, whole-document signals) — never a placeholder/guessed box.
  regions: PixelRect[] | null;
  module: string;
}

export function finding(f: Finding): Finding {
  return f;
}
