import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { makeImageWithText } from "./fixtures.js";

const app = createApp();

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

// Isolated in its own file with a generous timeout: tesseract.js has real
// startup cost (WASM init + language data, downloaded/cached on first use).
describe("OCR path for image-only documents", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it(
    "extracts text from a JPG/PNG via OCR and runs text-consistency analysis on it",
    async () => {
      const accessToken = await (async () => {
        const res = await request(app).post("/auth/register-organization").send({
          organizationName: "OCR Test Org",
          adminName: "Admin",
          email: uniqueEmail("ocr"),
          password: "correct-horse-battery",
        });
        return res.body.accessToken as string;
      })();

      const image = await makeImageWithText("INVOICE NUMBER 4471");

      const res = await request(app)
        .post("/verifications")
        .set("Authorization", `Bearer ${accessToken}`)
        .attach("file", image, { filename: "scan.png", contentType: "image/png" });

      expect(res.status).toBe(201);
      expect(["LOW_CONCERN", "SUSPICIOUS", "HIGH_RISK", "INCONCLUSIVE"]).toContain(res.body.status);

      const report = await request(app)
        .get(`/verifications/${res.body.id}/report`)
        .set("Authorization", `Bearer ${accessToken}`);
      expect(report.status).toBe(200);
      // IMAGE_SIGNAL layer always runs and produces at least the INFO metadata finding.
      expect(report.body.findings.IMAGE_SIGNAL).toBeDefined();
      expect(report.body.findings.IMAGE_SIGNAL.length).toBeGreaterThan(0);
    },
    60_000,
  );
});
