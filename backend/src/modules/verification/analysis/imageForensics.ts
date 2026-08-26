import sharp from "sharp";
import { finding, type Finding } from "../finding.js";

const MODULE_ELA = "imageForensics:ela";
const MODULE_COPY_MOVE = "imageForensics:copyMove";

// ============================================================================
// Shared helpers
// ============================================================================

async function getGrayscaleRaw(buffer: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(buffer).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function average(values: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return values.length > 0 ? sum / values.length : 0;
}

function standardDeviation(values: ArrayLike<number>, mean: number): number {
  let sumSq = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - mean;
    sumSq += d * d;
  }
  return values.length > 0 ? Math.sqrt(sumSq / values.length) : 0;
}

// ============================================================================
// Error Level Analysis (ELA) — splicing indicator
// ============================================================================
// Recompresses a JPEG at a known quality and diffs it against the original.
// Regions that were saved through a different compression history than the
// rest of the image (e.g. content pasted in from another source) show up as
// statistical outliers in the per-block error map. JPEG-only: recompression
// artifacts aren't meaningful for lossless formats (PNG/TIFF) or for a
// freshly-rendered PDF page with no prior compression history at all.

const ELA_QUALITY = 90;
const ELA_BLOCK_SIZE = 16;
// Out of 255. Empirically calibrated, not guessed: recompression error at
// quality 90 on already-high-quality content is small in absolute terms
// (single digits, not tens) — a synthetic splice test measured background
// blocks at ~0 and the spliced region at ~2-4. A floor of 15 (an earlier,
// unverified guess) completely swamped that real signal. This floor exists
// only to stop a near-zero-variance clean image's rounding noise from
// reading as a false "outlier" — it must stay well below realistic patch
// error levels, not above them.
const ELA_ABSOLUTE_FLOOR = 4;
const ELA_OUTLIER_STDDEV_MULTIPLIER = 2.5;

interface ElaRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  meanError: number;
}

function mergeFlaggedBlocksIntoRegions(
  flagged: Uint8Array,
  cols: number,
  rows: number,
  blockSize: number,
  blockMeans: Float64Array,
): ElaRegion[] {
  const visited = new Uint8Array(cols * rows);
  const regions: ElaRegion[] = [];

  for (let start = 0; start < flagged.length; start++) {
    if (!flagged[start] || visited[start]) continue;

    const stack = [start];
    visited[start] = 1;
    let minBx = start % cols;
    let maxBx = minBx;
    let minBy = Math.floor(start / cols);
    let maxBy = minBy;
    let sumError = 0;
    let count = 0;

    while (stack.length > 0) {
      const idx = stack.pop()!;
      const bx = idx % cols;
      const by = Math.floor(idx / cols);
      minBx = Math.min(minBx, bx);
      maxBx = Math.max(maxBx, bx);
      minBy = Math.min(minBy, by);
      maxBy = Math.max(maxBy, by);
      sumError += blockMeans[idx];
      count++;

      const neighbors = [
        bx > 0 ? idx - 1 : -1,
        bx < cols - 1 ? idx + 1 : -1,
        by > 0 ? idx - cols : -1,
        by < rows - 1 ? idx + cols : -1,
      ];
      for (const n of neighbors) {
        if (n >= 0 && flagged[n] && !visited[n]) {
          visited[n] = 1;
          stack.push(n);
        }
      }
    }

    regions.push({
      x: minBx * blockSize,
      y: minBy * blockSize,
      width: (maxBx - minBx + 1) * blockSize,
      height: (maxBy - minBy + 1) * blockSize,
      meanError: Math.round((sumError / count) * 100) / 100,
    });
  }

  return regions;
}

export async function computeErrorLevelAnalysis(buffer: Buffer): Promise<Finding[]> {
  // Self-contained error handling — this function must be safe to call
  // directly (not just through analyzeImageForensics' wrapper), consistent
  // with how every other analyzer in this codebase degrades gracefully on
  // an unreadable file rather than crashing the request.
  try {
    return await computeErrorLevelAnalysisUnsafe(buffer);
  } catch {
    return [];
  }
}

async function computeErrorLevelAnalysisUnsafe(buffer: Buffer): Promise<Finding[]> {
  const metadata = await sharp(buffer).metadata();
  if (metadata.format !== "jpeg") return [];

  const recompressed = await sharp(buffer).jpeg({ quality: ELA_QUALITY }).toBuffer();
  const [original, recompressedGray] = await Promise.all([getGrayscaleRaw(buffer), getGrayscaleRaw(recompressed)]);

  if (original.width !== recompressedGray.width || original.height !== recompressedGray.height) {
    return []; // dimension mismatch should never happen for a same-content recompression; never crash on it either
  }

  const { width, height } = original;
  const errorMap = new Uint8Array(width * height);
  for (let i = 0; i < errorMap.length; i++) {
    errorMap[i] = Math.abs(original.data[i] - recompressedGray.data[i]);
  }

  const cols = Math.ceil(width / ELA_BLOCK_SIZE);
  const rows = Math.ceil(height / ELA_BLOCK_SIZE);
  const blockMeans = new Float64Array(cols * rows);

  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const x0 = bx * ELA_BLOCK_SIZE;
      const y0 = by * ELA_BLOCK_SIZE;
      const x1 = Math.min(x0 + ELA_BLOCK_SIZE, width);
      const y1 = Math.min(y0 + ELA_BLOCK_SIZE, height);
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          sum += errorMap[y * width + x];
          count++;
        }
      }
      blockMeans[by * cols + bx] = count > 0 ? sum / count : 0;
    }
  }

  const mean = average(blockMeans);
  const stdDev = standardDeviation(blockMeans, mean);
  const threshold = Math.max(mean + ELA_OUTLIER_STDDEV_MULTIPLIER * stdDev, ELA_ABSOLUTE_FLOOR);

  const flagged = new Uint8Array(cols * rows);
  for (let i = 0; i < blockMeans.length; i++) {
    if (blockMeans[i] > threshold) flagged[i] = 1;
  }

  const regions = mergeFlaggedBlocksIntoRegions(flagged, cols, rows, ELA_BLOCK_SIZE, blockMeans);
  if (regions.length === 0) return [];

  return [
    finding({
      category: "IMAGE_SIGNAL",
      severity: "MEDIUM",
      confidence: 0.5,
      description: `Error level analysis identified ${regions.length} region(s) with compression characteristics inconsistent with the rest of the image — a possible indicator of splicing (content from a different source or compression history). ELA has well-known false-positive tendencies around legitimate high-contrast edges and JPEG block boundaries; this is supplementary evidence, not proof.`,
      evidence: { regions, meanBlockError: Math.round(mean * 100) / 100, thresholdUsed: Math.round(threshold * 100) / 100, elaQuality: ELA_QUALITY },
      page: null,
      regions: regions.map(({ x, y, width, height }) => ({ x, y, width, height })),
      module: MODULE_ELA,
    }),
  ];
}

// ============================================================================
// Block-hash copy-move detection — cloned/duplicated region indicator
// ============================================================================
// Downscales once (critical for performance — this avoids tens of thousands
// of per-block image-library calls), hashes overlapping blocks via a coarse
// average-hash, groups exact hash matches, verifies each candidate pair by
// direct pixel comparison (hash collisions are otherwise a real risk with a
// hash this coarse), then requires multiple block-pairs sharing a consistent
// spatial offset before reporting — an isolated match is exactly the kind of
// coincidence a real duplicated *region* (not a single block) would not
// produce; a cluster of correspondences with the same offset vector is the
// actual signature of a moved region.

const CM_MAX_DIMENSION = 800;
const CM_BLOCK_SIZE = 16;
const CM_STRIDE = 8;
const CM_SUBGRID = 8; // 8x8 sub-cells -> 64-bit hash, low collision rate
const CM_MIN_VARIANCE = 100; // skip near-flat blocks (backgrounds/margins) — the single biggest false-positive guard
const CM_MIN_SPATIAL_DISTANCE = 48; // px, in the downscaled working image
const CM_VERIFY_MAX_MEAN_ABS_DIFF = 10; // out of 255 — direct pixel check confirming a hash match is a real visual match
const CM_OFFSET_BUCKET = CM_STRIDE; // round offsets to the nearest stride when clustering
const CM_MIN_SUPPORTING_PAIRS = 3;

interface BlockPosition {
  bx: number;
  by: number;
}

function blockVariance(data: Buffer, width: number, bx: number, by: number): { mean: number; variance: number } {
  let sum = 0;
  for (let y = 0; y < CM_BLOCK_SIZE; y++) {
    for (let x = 0; x < CM_BLOCK_SIZE; x++) {
      sum += data[(by + y) * width + (bx + x)];
    }
  }
  const mean = sum / (CM_BLOCK_SIZE * CM_BLOCK_SIZE);
  let sumSq = 0;
  for (let y = 0; y < CM_BLOCK_SIZE; y++) {
    for (let x = 0; x < CM_BLOCK_SIZE; x++) {
      const d = data[(by + y) * width + (bx + x)] - mean;
      sumSq += d * d;
    }
  }
  return { mean, variance: sumSq / (CM_BLOCK_SIZE * CM_BLOCK_SIZE) };
}

function blockHash(data: Buffer, width: number, bx: number, by: number, blockMean: number): string {
  const cellSize = CM_BLOCK_SIZE / CM_SUBGRID;
  let hashHi = 0;
  let hashLo = 0;
  let bit = 0;
  for (let cy = 0; cy < CM_SUBGRID; cy++) {
    for (let cx = 0; cx < CM_SUBGRID; cx++) {
      let cellSum = 0;
      for (let y = 0; y < cellSize; y++) {
        for (let x = 0; x < cellSize; x++) {
          cellSum += data[(by + cy * cellSize + y) * width + (bx + cx * cellSize + x)];
        }
      }
      const cellMean = cellSum / (cellSize * cellSize);
      if (cellMean > blockMean) {
        if (bit < 32) hashLo |= 1 << bit;
        else hashHi |= 1 << (bit - 32);
      }
      bit++;
    }
  }
  return `${hashHi}:${hashLo}`;
}

function meanAbsDiff(data: Buffer, width: number, a: BlockPosition, b: BlockPosition): number {
  let sum = 0;
  for (let y = 0; y < CM_BLOCK_SIZE; y++) {
    for (let x = 0; x < CM_BLOCK_SIZE; x++) {
      sum += Math.abs(data[(a.by + y) * width + (a.bx + x)] - data[(b.by + y) * width + (b.bx + x)]);
    }
  }
  return sum / (CM_BLOCK_SIZE * CM_BLOCK_SIZE);
}

export async function computeCopyMoveDetection(buffer: Buffer): Promise<Finding[]> {
  try {
    return await computeCopyMoveDetectionUnsafe(buffer);
  } catch {
    return [];
  }
}

async function computeCopyMoveDetectionUnsafe(buffer: Buffer): Promise<Finding[]> {
  const metadata = await sharp(buffer).metadata();
  const origWidth = metadata.width ?? 0;
  const origHeight = metadata.height ?? 0;
  if (!origWidth || !origHeight) return [];

  const scale = Math.min(1, CM_MAX_DIMENSION / Math.max(origWidth, origHeight));
  const targetWidth = Math.max(CM_BLOCK_SIZE, Math.round(origWidth * scale));
  const targetHeight = Math.max(CM_BLOCK_SIZE, Math.round(origHeight * scale));

  const { data, info } = await sharp(buffer)
    .resize(targetWidth, targetHeight, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const inverseScale = 1 / (targetWidth / origWidth);

  const hashMap = new Map<string, BlockPosition[]>();

  for (let by = 0; by + CM_BLOCK_SIZE <= height; by += CM_STRIDE) {
    for (let bx = 0; bx + CM_BLOCK_SIZE <= width; bx += CM_STRIDE) {
      const { mean, variance } = blockVariance(data, width, bx, by);
      if (variance < CM_MIN_VARIANCE) continue;

      const hash = blockHash(data, width, bx, by, mean);
      const entries = hashMap.get(hash);
      if (entries) entries.push({ bx, by });
      else hashMap.set(hash, [{ bx, by }]);
    }
  }

  // Candidate pairs: same hash, far apart, and confirmed by direct pixel comparison.
  const offsetGroups = new Map<string, Array<{ a: BlockPosition; b: BlockPosition }>>();
  for (const entries of hashMap.values()) {
    if (entries.length < 2) continue;
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];
        const dist = Math.hypot(a.bx - b.bx, a.by - b.by);
        if (dist < CM_MIN_SPATIAL_DISTANCE) continue;
        if (meanAbsDiff(data, width, a, b) > CM_VERIFY_MAX_MEAN_ABS_DIFF) continue;

        const dx = Math.round((b.bx - a.bx) / CM_OFFSET_BUCKET) * CM_OFFSET_BUCKET;
        const dy = Math.round((b.by - a.by) / CM_OFFSET_BUCKET) * CM_OFFSET_BUCKET;
        const key = `${dx},${dy}`;
        const group = offsetGroups.get(key);
        if (group) group.push({ a, b });
        else offsetGroups.set(key, [{ a, b }]);
      }
    }
  }

  const findings: Finding[] = [];
  for (const pairs of offsetGroups.values()) {
    if (pairs.length < CM_MIN_SUPPORTING_PAIRS) continue;

    const toOriginal = (p: BlockPosition) => ({ x: Math.round(p.bx * inverseScale), y: Math.round(p.by * inverseScale) });
    const aXs = pairs.map((p) => p.a.bx);
    const aYs = pairs.map((p) => p.a.by);
    const bXs = pairs.map((p) => p.b.bx);
    const bYs = pairs.map((p) => p.b.by);
    const blockSizeOrig = Math.round(CM_BLOCK_SIZE * inverseScale);

    const regionA = {
      ...toOriginal({ bx: Math.min(...aXs), by: Math.min(...aYs) }),
      width: Math.round((Math.max(...aXs) - Math.min(...aXs)) * inverseScale) + blockSizeOrig,
      height: Math.round((Math.max(...aYs) - Math.min(...aYs)) * inverseScale) + blockSizeOrig,
    };
    const regionB = {
      ...toOriginal({ bx: Math.min(...bXs), by: Math.min(...bYs) }),
      width: Math.round((Math.max(...bXs) - Math.min(...bXs)) * inverseScale) + blockSizeOrig,
      height: Math.round((Math.max(...bYs) - Math.min(...bYs)) * inverseScale) + blockSizeOrig,
    };

    findings.push(
      finding({
        category: "IMAGE_SIGNAL",
        severity: "MEDIUM",
        confidence: 0.4,
        description:
          "A region of this image appears to be duplicated elsewhere in the same image, with a consistent spatial offset across multiple matching blocks. This can indicate a copy-move edit (content cloned to hide or duplicate something) — but repeating patterns, textures, or design elements common in legitimate documents can also cause this.",
        evidence: { regionA, regionB, supportingBlockPairs: pairs.length },
        page: null,
        regions: [regionA, regionB],
        module: MODULE_COPY_MOVE,
      }),
    );
  }

  return findings;
}

export async function analyzeImageForensics(buffer: Buffer): Promise<Finding[]> {
  // Both functions handle their own errors (see above) — safe to run
  // concurrently without an extra catch layer here.
  const [elaFindings, copyMoveFindings] = await Promise.all([
    computeErrorLevelAnalysis(buffer),
    computeCopyMoveDetection(buffer),
  ]);
  return [...elaFindings, ...copyMoveFindings];
}
