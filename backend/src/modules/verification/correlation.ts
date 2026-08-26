import type { FindingCategory, FindingSeverity } from "@prisma/client";
import type { PixelRect } from "./finding.js";

// Minimal shape correlation needs — works on both in-memory Finding[]
// (tests) and Prisma-persisted VerificationFinding rows (evidenceReport.ts),
// which additionally carry id/timestamps this doesn't need.
export interface CorrelatableFinding {
  module: string;
  category: FindingCategory;
  severity: FindingSeverity;
  description: string;
  page: number | null;
  regions: PixelRect[] | null;
}

export interface CorrelationCluster {
  page: number | null;
  // Union bounding box of every contributing finding's regions; null for a
  // page-level cluster (findings on this page with no region data at all —
  // never claimed to be "in" a specific area they have no coordinates for).
  region: PixelRect | null;
  moduleCount: number;
  modules: string[];
  findingCount: number; // after de-duplication — see dedupe() below
  maxSeverity: FindingSeverity;
  // moduleCount >= 2: independent detectors agreeing on the same page/
  // region, not one detector's own multiple findings there (which is what
  // dedupe() plus the module-based grouping here specifically distinguishes
  // from — "don't double-count identical signals").
  corroborated: boolean;
}

const SEVERITY_RANK: Record<FindingSeverity, number> = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };

function findingKey(f: CorrelatableFinding): string {
  const regionKey = f.regions ? f.regions.map((r) => `${r.x},${r.y},${r.width},${r.height}`).join(";") : "";
  return `${f.module}|${f.description}|${f.page}|${regionKey}`;
}

// Findings sharing (module, description, page, regions) collapse to one.
// Necessary before counting "distinct modules" per cluster below — without
// this, one detector firing the same finding twice would look identical to
// two independent detectors corroborating each other.
function dedupe(findings: CorrelatableFinding[]): CorrelatableFinding[] {
  const seen = new Set<string>();
  const result: CorrelatableFinding[] = [];
  for (const f of findings) {
    const key = findingKey(f);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(f);
  }
  return result;
}

function rectsOverlap(a: PixelRect, b: PixelRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function unionRect(rects: PixelRect[]): PixelRect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.width));
  const y1 = Math.max(...rects.map((r) => r.y + r.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function maxSeverityOf(findings: CorrelatableFinding[]): FindingSeverity {
  let max: FindingSeverity = "INFO";
  for (const f of findings) {
    if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[max]) max = f.severity;
  }
  return max;
}

function buildCluster(members: CorrelatableFinding[], page: number | null, region: PixelRect | null): CorrelationCluster {
  const modules = [...new Set(members.map((m) => m.module))];
  return {
    page,
    region,
    moduleCount: modules.length,
    modules,
    findingCount: members.length,
    maxSeverity: maxSeverityOf(members),
    corroborated: modules.length >= 2,
  };
}

// Groups findings that are "concentrated on the same page/region." Within a
// page, findings with region data cluster by rectangle overlap (transitive —
// union-find over pairwise intersection, so A-overlaps-B and B-overlaps-C
// merge all three even if A and C don't directly touch); findings on the
// same page with non-overlapping regions correctly stay in separate
// clusters. Findings without region data form their own page-level cluster
// rather than being folded into a region cluster they have no coordinates
// to justify.
export function correlateFindings(rawFindings: CorrelatableFinding[]): CorrelationCluster[] {
  const findings = dedupe(rawFindings);
  const clusters: CorrelationCluster[] = [];

  const byPage = new Map<string, CorrelatableFinding[]>();
  for (const f of findings) {
    const key = f.page === null ? "null" : String(f.page);
    const list = byPage.get(key) ?? [];
    list.push(f);
    byPage.set(key, list);
  }

  for (const pageFindings of byPage.values()) {
    const page = pageFindings[0].page;
    const withRegions = pageFindings.filter((f) => f.regions && f.regions.length > 0);
    const withoutRegions = pageFindings.filter((f) => !f.regions || f.regions.length === 0);

    const parent = withRegions.map((_, i) => i);
    function find(i: number): number {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    }
    function union(i: number, j: number) {
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) parent[ri] = rj;
    }
    for (let i = 0; i < withRegions.length; i++) {
      for (let j = i + 1; j < withRegions.length; j++) {
        const overlap = withRegions[i].regions!.some((ra) => withRegions[j].regions!.some((rb) => rectsOverlap(ra, rb)));
        if (overlap) union(i, j);
      }
    }

    const groups = new Map<number, CorrelatableFinding[]>();
    for (let i = 0; i < withRegions.length; i++) {
      const root = find(i);
      const list = groups.get(root) ?? [];
      list.push(withRegions[i]);
      groups.set(root, list);
    }
    for (const members of groups.values()) {
      const allRects = members.flatMap((m) => m.regions!);
      clusters.push(buildCluster(members, page, unionRect(allRects)));
    }

    if (withoutRegions.length > 0) {
      clusters.push(buildCluster(withoutRegions, page, null));
    }
  }

  return clusters;
}
