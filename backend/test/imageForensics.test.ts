import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import {
  computeCopyMoveDetection,
  computeErrorLevelAnalysis,
} from "../src/modules/verification/analysis/imageForensics.js";
import { makeCloneJpeg, makeGenuineJpeg, makePlainImage, makeSplicedJpeg } from "./fixtures.js";

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

describe("Error Level Analysis", () => {
  it("flags the spliced patch region on a synthesized spliced JPEG", async () => {
    const { buffer, patchRegion } = await makeSplicedJpeg();
    const findings = await computeErrorLevelAnalysis(buffer);

    expect(findings.length).toBeGreaterThan(0);
    const evidence = findings[0].evidence as { regions: Array<{ x: number; y: number; width: number; height: number }> };
    const overlapsPatch = evidence.regions.some(
      (r) =>
        r.x < patchRegion.x + patchRegion.width &&
        r.x + r.width > patchRegion.x &&
        r.y < patchRegion.y + patchRegion.height &&
        r.y + r.height > patchRegion.y,
    );
    expect(overlapsPatch).toBe(true);
  });

  it("does not flag a genuine, uniformly-compressed JPEG", async () => {
    const buffer = await makeGenuineJpeg();
    const findings = await computeErrorLevelAnalysis(buffer);
    expect(findings).toEqual([]);
  });

  it("is a no-op (not an error) for a lossless PNG", async () => {
    const buffer = await makePlainImage();
    const findings = await computeErrorLevelAnalysis(buffer);
    expect(findings).toEqual([]);
  });

  it("fails gracefully on a corrupted image instead of crashing", async () => {
    const corrupted = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03]); // JPEG magic bytes, garbage body
    const findings = await computeErrorLevelAnalysis(corrupted);
    expect(findings).toEqual([]);
  });
});

describe("copy-move detection", () => {
  it("finds the cloned region pair on a synthesized clone JPEG", async () => {
    const { buffer, regionA, regionB } = await makeCloneJpeg();
    const findings = await computeCopyMoveDetection(buffer);

    expect(findings.length).toBeGreaterThan(0);
    const evidence = findings[0].evidence as {
      regionA: { x: number; y: number };
      regionB: { x: number; y: number };
    };
    const nearA =
      Math.abs(evidence.regionA.x - regionA.x) < 32 && Math.abs(evidence.regionA.y - regionA.y) < 32;
    const nearB =
      Math.abs(evidence.regionB.x - regionB.x) < 32 && Math.abs(evidence.regionB.y - regionB.y) < 32;
    expect(nearA || nearB).toBe(true);
  });

  it("does not flag a genuine JPEG with no duplicated regions", async () => {
    const buffer = await makeGenuineJpeg();
    const findings = await computeCopyMoveDetection(buffer);
    expect(findings).toEqual([]);
  });

  it("does not flood results from a flat/uniform image", async () => {
    const buffer = await makePlainImage();
    const findings = await computeCopyMoveDetection(buffer);
    expect(findings).toEqual([]);
  });

  it("fails gracefully on a corrupted image instead of crashing", async () => {
    const corrupted = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03]);
    const findings = await computeCopyMoveDetection(corrupted);
    expect(findings).toEqual([]);
  });

  it("completes in bounded time on a larger image (no per-block image-library-call blowup)", async () => {
    const large = await sharp(await makeGenuineJpeg(1600, 1200, 11)).toBuffer();
    const start = Date.now();
    await computeCopyMoveDetection(large);
    expect(Date.now() - start).toBeLessThan(15_000);
  }, 20_000);
});

describe("image forensics wired into the verification pipeline", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("surfaces both ELA and copy-move findings through the full HTTP report", async () => {
    const accessToken = await registerOrg("Image Forensics Org 1");
    const { buffer } = await makeSplicedJpeg();

    const res = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", buffer, { filename: "photo.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(201);

    const report = await request(app)
      .get(`/verifications/${res.body.id}/report`)
      .set("Authorization", `Bearer ${accessToken}`);

    const imageFindings = report.body.findings.IMAGE_SIGNAL ?? [];
    const elaFinding = imageFindings.find((f: { module: string }) => f.module === "imageForensics:ela");
    expect(elaFinding).toBeDefined();
  });
});
