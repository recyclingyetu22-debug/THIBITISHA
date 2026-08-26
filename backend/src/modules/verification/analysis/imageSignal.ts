import sharp from "sharp";
import exifReader from "exif-reader";
import { finding, type Finding } from "../finding.js";

const MODULE = "imageSignal";
const EDITING_SOFTWARE_PATTERN = /photoshop|gimp|affinity photo|paint\.net|lightroom/i;

export interface ImageSignalResult {
  readable: boolean;
  pageCount: number | null;
  findings: Finding[];
  software: string | null;
}

// Layer 6, deliberately "lite" (spec §12, scoped down per the Increment 1
// plan): sharp's own metadata + EXIF tags only. Pixel-level forensics
// (compression-consistency analysis, resampling detection, copy-move/cloned
// region detection) is real computer-vision work and a later increment —
// this increment establishes the module seam, not the full technique.
export async function analyzeImageSignal(buffer: Buffer): Promise<ImageSignalResult> {
  let metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch (err) {
    return {
      readable: false,
      pageCount: null,
      software: null,
      findings: [
        finding({
          category: "IMAGE_SIGNAL",
          severity: "HIGH",
          confidence: null,
          description: "The image could not be read — it may be corrupted or malformed.",
          evidence: { error: err instanceof Error ? err.message : String(err) },
          page: null,
          regions: null,
          module: MODULE,
        }),
      ],
    };
  }

  const findings: Finding[] = [];
  let exifTags: Record<string, unknown> | null = null;
  if (metadata.exif) {
    try {
      exifTags = exifReader(metadata.exif) as unknown as Record<string, unknown>;
    } catch {
      exifTags = null;
    }
  }

  const imageIfd = (exifTags?.Image ?? null) as Record<string, unknown> | null;
  const software = typeof imageIfd?.Software === "string" ? imageIfd.Software : null;

  findings.push(
    finding({
      category: "IMAGE_SIGNAL",
      severity: "INFO",
      confidence: null,
      description: "Image metadata.",
      evidence: {
        format: metadata.format ?? null,
        width: metadata.width ?? null,
        height: metadata.height ?? null,
        hasExif: Boolean(metadata.exif),
        software,
      },
      page: null,
      regions: null,
      module: MODULE,
    }),
  );

  if (software && EDITING_SOFTWARE_PATTERN.test(software)) {
    findings.push(
      finding({
        category: "IMAGE_SIGNAL",
        severity: "LOW",
        confidence: null,
        description: "Image metadata indicates it was processed with photo-editing software.",
        evidence: { software },
        page: null,
        regions: null,
        module: MODULE,
      }),
    );
  }

  return { readable: true, pageCount: 1, software, findings };
}
