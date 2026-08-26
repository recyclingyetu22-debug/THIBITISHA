import { describe, expect, it } from "vitest";
import { correlateFindings, type CorrelatableFinding } from "../src/modules/verification/correlation.js";

function f(overrides: Partial<CorrelatableFinding>): CorrelatableFinding {
  return {
    module: "testModule",
    category: "PDF_STRUCTURE",
    severity: "MEDIUM",
    description: "test finding",
    page: 1,
    regions: null,
    ...overrides,
  };
}

const REGION_A = { x: 0, y: 0, width: 100, height: 100 };
const REGION_B = { x: 50, y: 50, width: 100, height: 100 }; // overlaps REGION_A
const REGION_C = { x: 500, y: 500, width: 50, height: 50 }; // does not overlap A/B

describe("correlateFindings: duplicate suppression", () => {
  it("collapses two identical findings into one, findingCount reflecting the dedup", () => {
    const duplicate = f({ module: "typography", description: "Text \"X\" uses a different size", regions: [REGION_A] });
    const clusters = correlateFindings([duplicate, { ...duplicate }]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].findingCount).toBe(1);
    expect(clusters[0].moduleCount).toBe(1);
    expect(clusters[0].corroborated).toBe(false);
  });

  it("does not treat two DIFFERENT findings from the same module as duplicates", () => {
    const a = f({ module: "typography", description: "finding A", regions: [REGION_A] });
    const b = f({ module: "typography", description: "finding B", regions: [REGION_A] });
    const clusters = correlateFindings([a, b]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].findingCount).toBe(2);
    expect(clusters[0].moduleCount).toBe(1);
    expect(clusters[0].corroborated).toBe(false); // same module, not independent corroboration
  });
});

describe("correlateFindings: region-overlap clustering", () => {
  it("merges findings from two DIFFERENT modules with overlapping regions into one corroborated cluster", () => {
    const a = f({ module: "typography", regions: [REGION_A] });
    const b = f({ module: "regionForensics", regions: [REGION_B] });
    const clusters = correlateFindings([a, b]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].moduleCount).toBe(2);
    expect(clusters[0].modules.sort()).toEqual(["regionForensics", "typography"]);
    expect(clusters[0].corroborated).toBe(true);
    expect(clusters[0].findingCount).toBe(2);
  });

  it("keeps findings on the same page but with NON-overlapping regions in separate clusters", () => {
    const a = f({ module: "typography", regions: [REGION_A] });
    const b = f({ module: "regionForensics", regions: [REGION_C] });
    const clusters = correlateFindings([a, b]);

    expect(clusters).toHaveLength(2);
    for (const cluster of clusters) {
      expect(cluster.moduleCount).toBe(1);
      expect(cluster.corroborated).toBe(false);
    }
  });

  it("keeps a page-level (no-region) finding separate from a region-having finding on the same page", () => {
    const pageLevel = f({ module: "pdfStructure", regions: null });
    const regional = f({ module: "regionForensics", regions: [REGION_A] });
    const clusters = correlateFindings([pageLevel, regional]);

    expect(clusters).toHaveLength(2);
    const regionCluster = clusters.find((c) => c.region !== null);
    const pageCluster = clusters.find((c) => c.region === null);
    expect(regionCluster?.modules).toEqual(["regionForensics"]);
    expect(pageCluster?.modules).toEqual(["pdfStructure"]);
  });

  it("puts findings on different pages into different clusters even with identical/overlapping regions", () => {
    const a = f({ module: "typography", page: 1, regions: [REGION_A] });
    const b = f({ module: "regionForensics", page: 2, regions: [REGION_A] });
    const clusters = correlateFindings([a, b]);

    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.page).sort()).toEqual([1, 2]);
  });

  it("transitively merges A-overlaps-B and B-overlaps-C even when A and C don't directly touch", () => {
    const regionMiddle = { x: 40, y: 40, width: 100, height: 100 }; // overlaps REGION_A and a third far region
    const regionFar = { x: 120, y: 120, width: 100, height: 100 }; // overlaps regionMiddle, not REGION_A directly
    const a = f({ module: "moduleA", regions: [REGION_A] });
    const b = f({ module: "moduleB", regions: [regionMiddle] });
    const c = f({ module: "moduleC", regions: [regionFar] });
    const clusters = correlateFindings([a, b, c]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].moduleCount).toBe(3);
  });
});

describe("correlateFindings: maxSeverity", () => {
  it("reports the highest severity present in a cluster", () => {
    const low = f({ module: "a", severity: "LOW", regions: [REGION_A] });
    const high = f({ module: "b", severity: "HIGH", regions: [REGION_A] });
    const clusters = correlateFindings([low, high]);

    expect(clusters[0].maxSeverity).toBe("HIGH");
  });
});
