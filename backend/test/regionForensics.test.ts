import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { analyzeImageRegionForensics, analyzePdfRegionForensics } from "../src/modules/verification/analysis/regionForensics.js";
import {
  makeGenuineJpeg,
  makeHardEdgePatchJpeg,
  makePdfWithHardEdgeEmbeddedImage,
  makePdfWithNearFullPageImage,
  makePdfWithSoftEdgeEmbeddedImage,
  makePdfWithText,
} from "./fixtures.js";

const app = createApp();

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

async function registerOrg(orgName: string) {
  const res = await request(app).post("/auth/register-organization").send({
    organizationName: orgName,
    adminName: "Org Admin",
    email: uniqueEmail("officer"),
    password: "correct-horse-battery",
  });
  return res.body.accessToken as string;
}

describe("region forensics: PDF candidate regions", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("flags a small, sharply-bounded embedded image as an embedded-image boundary anomaly", async () => {
    const { buffer, placement } = await makePdfWithHardEdgeEmbeddedImage();
    const findings = await analyzePdfRegionForensics(buffer);

    const embeddedFinding = findings.find(
      (f) => (f.evidence as { regionSource?: string } | null)?.regionSource === "embedded-image",
    );
    expect(embeddedFinding).toBeDefined();
    expect(embeddedFinding?.category).toBe("REGION_FORENSICS");
    expect(embeddedFinding?.severity).toBe("MEDIUM");
    expect(embeddedFinding?.page).toBe(1);

    const rect = (embeddedFinding?.evidence as { rect: { x: number; y: number; width: number; height: number } }).rect;
    // Rect is in rasterized pixel space (RASTERIZE_SCALE-scaled PDF points)
    // — assert it's in the right neighborhood, not exact pixel equality.
    expect(rect.width).toBeGreaterThan(placement.width);
    expect(rect.height).toBeGreaterThan(placement.height);
  });

  it("does not flag a small, softly-blended embedded image", async () => {
    const buffer = await makePdfWithSoftEdgeEmbeddedImage();
    const findings = await analyzePdfRegionForensics(buffer);

    const embeddedFinding = findings.find(
      (f) => (f.evidence as { regionSource?: string } | null)?.regionSource === "embedded-image",
    );
    expect(embeddedFinding).toBeUndefined();
  });

  it("excludes an image covering most of the page (simulated scan) from embedded-image candidates", async () => {
    const buffer = await makePdfWithNearFullPageImage();
    const findings = await analyzePdfRegionForensics(buffer);

    const embeddedFinding = findings.find(
      (f) => (f.evidence as { regionSource?: string } | null)?.regionSource === "embedded-image",
    );
    expect(embeddedFinding).toBeUndefined();
  });

  it("runs the grid fallback on a plain text page without spurious findings", async () => {
    const buffer = await makePdfWithText([
      "This is a routine letter with nothing embedded in it at all.",
      "It has multiple lines of ordinary body text on a plain white page.",
      "No signatures, seals, logos, or photographs appear anywhere in it.",
    ]);
    const findings = await analyzePdfRegionForensics(buffer);
    expect(findings).toEqual([]);
  });
});

describe("region forensics: standalone images", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("flags a hard-edged pasted patch as a grid-cell boundary anomaly", async () => {
    const { buffer } = await makeHardEdgePatchJpeg();
    const findings = await analyzeImageRegionForensics(buffer);

    expect(findings.length).toBeGreaterThan(0);
    const f = findings[0];
    expect(f.category).toBe("REGION_FORENSICS");
    expect((f.evidence as { regionSource: string }).regionSource).toBe("grid-cell");
    expect(f.page).toBeNull();
  });

  it("does not flag a genuine, unmodified image", async () => {
    const buffer = await makeGenuineJpeg();
    const findings = await analyzeImageRegionForensics(buffer);
    expect(findings).toEqual([]);
  });
});

describe("region forensics: HTTP report + tenant isolation", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("surfaces a REGION_FORENSICS finding through the full HTTP report with page and rect", async () => {
    const accessToken = await registerOrg("Region Forensics Org 1");
    const { buffer } = await makePdfWithHardEdgeEmbeddedImage();

    const res = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", buffer, { filename: "certificate.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(201);

    const report = await request(app)
      .get(`/verifications/${res.body.id}/report`)
      .set("Authorization", `Bearer ${accessToken}`);

    const regionFindings = report.body.findings.REGION_FORENSICS ?? [];
    expect(regionFindings.length).toBeGreaterThan(0);
    expect(regionFindings[0].page).toBe(1);
    expect(regionFindings[0].evidence.rect).toBeDefined();
  });

  it("never lets one organization read another organization's region-forensics findings", async () => {
    const orgA = await registerOrg("Region Forensics Org A");
    const orgB = await registerOrg("Region Forensics Org B");
    const { buffer } = await makePdfWithHardEdgeEmbeddedImage();

    const created = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${orgA}`)
      .attach("file", buffer, { filename: "doc.pdf", contentType: "application/pdf" });

    const crossOrgRead = await request(app)
      .get(`/verifications/${created.body.id}`)
      .set("Authorization", `Bearer ${orgB}`);
    expect(crossOrgRead.status).toBe(404);
  });
});
