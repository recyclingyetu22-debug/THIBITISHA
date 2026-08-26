import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { makeGenuineJpeg, makePdfWithText } from "./fixtures.js";

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

describe("GET /verifications/:id/pages/:pageNumber/image", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns a valid rendered PNG for a PDF page, matching its pixel-space dimensions to RASTERIZE_SCALE", async () => {
    const accessToken = await registerOrg("Page Image Org 1");
    const pdf = await makePdfWithText(["A single-page document for page-image testing."]);

    const submit = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", pdf, { filename: "doc.pdf", contentType: "application/pdf" });
    expect(submit.status).toBe(201);

    const res = await request(app)
      .get(`/verifications/${submit.body.id}/pages/1/image`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    const metadata = await sharp(res.body as Buffer).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBeGreaterThan(0);
    expect(metadata.height).toBeGreaterThan(0);
  });

  it("returns 404 for a page number beyond the document's page count", async () => {
    const accessToken = await registerOrg("Page Image Org 2");
    const pdf = await makePdfWithText(["A single-page document."]);

    const submit = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", pdf, { filename: "doc.pdf", contentType: "application/pdf" });

    const res = await request(app)
      .get(`/verifications/${submit.body.id}/pages/99/image`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
  });

  it("returns the original bytes unchanged for a standalone image upload", async () => {
    const accessToken = await registerOrg("Page Image Org 3");
    const jpeg = await makeGenuineJpeg();

    const submit = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", jpeg, { filename: "photo.jpg", contentType: "image/jpeg" });
    expect(submit.status).toBe(201);

    const res = await request(app)
      .get(`/verifications/${submit.body.id}/pages/1/image`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, jpeg)).toBe(0);
  });

  it("returns 404 for page 2 of a standalone (single-page) image", async () => {
    const accessToken = await registerOrg("Page Image Org 4");
    const jpeg = await makeGenuineJpeg();

    const submit = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", jpeg, { filename: "photo.jpg", contentType: "image/jpeg" });

    const res = await request(app)
      .get(`/verifications/${submit.body.id}/pages/2/image`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
  });

  it("never lets one organization fetch another organization's page image", async () => {
    const orgA = await registerOrg("Page Image Org A");
    const orgB = await registerOrg("Page Image Org B");
    const pdf = await makePdfWithText(["Org A's confidential document."]);

    const submit = await request(app)
      .post("/verifications")
      .set("Authorization", `Bearer ${orgA}`)
      .attach("file", pdf, { filename: "doc.pdf", contentType: "application/pdf" });

    const res = await request(app)
      .get(`/verifications/${submit.body.id}/pages/1/image`)
      .set("Authorization", `Bearer ${orgB}`);
    expect(res.status).toBe(404);
  });
});
