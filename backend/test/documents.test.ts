import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";

const app = createApp();

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

async function registerOrg(orgName: string) {
  const email = uniqueEmail("officer");
  const res = await request(app).post("/auth/register-organization").send({
    organizationName: orgName,
    adminName: "Org Admin",
    email,
    password: "correct-horse-battery",
  });
  return { accessToken: res.body.accessToken as string, organizationId: res.body.organization.id as string };
}

const PDF_BYTES = Buffer.from("%PDF-1.4\n%mock document sentinel test file\n%%EOF", "latin1");

describe("documents", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("registers a document, computes a correct SHA-256, and assigns a DOC-<year>-<seq> number", async () => {
    const { accessToken } = await registerOrg("Registrar U");

    const res = await request(app)
      .post("/documents")
      .set("Authorization", `Bearer ${accessToken}`)
      .field("documentType", "certificate")
      .field("title", "Bachelor of Science")
      .attach("file", PDF_BYTES, { filename: "cert.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(201);
    expect(res.body.documentNumber).toMatch(/^DOC-\d{4}-\d{8}$/);
    expect(res.body.version.versionNumber).toBe(1);

    const expectedSha256 = createHash("sha256").update(PDF_BYTES).digest("hex");
    expect(res.body.version.sha256).toBe(expectedSha256);

    const getRes = await request(app)
      .get(`/documents/${res.body.id}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.currentVersion.sha256).toBe(expectedSha256);
  });

  it("rejects a file whose bytes don't match its declared type", async () => {
    const { accessToken } = await registerOrg("Registrar U 2");

    const res = await request(app)
      .post("/documents")
      .set("Authorization", `Bearer ${accessToken}`)
      .field("documentType", "certificate")
      .field("title", "Fake PDF")
      .attach("file", Buffer.from("not actually a pdf"), { filename: "cert.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(422);
  });

  it("never lets one organization read another organization's document", async () => {
    const orgA = await registerOrg("Org A");
    const orgB = await registerOrg("Org B");

    const created = await request(app)
      .post("/documents")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .field("documentType", "certificate")
      .field("title", "Org A Secret Doc")
      .attach("file", PDF_BYTES, { filename: "secret.pdf", contentType: "application/pdf" });

    expect(created.status).toBe(201);

    const crossOrgRead = await request(app)
      .get(`/documents/${created.body.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`);

    expect(crossOrgRead.status).toBe(404);

    const crossOrgList = await request(app)
      .get("/documents")
      .set("Authorization", `Bearer ${orgB.accessToken}`);
    expect(crossOrgList.body).toEqual([]);
  });

  it("streams the original file back on download with matching bytes", async () => {
    const { accessToken } = await registerOrg("Registrar U 3");

    const created = await request(app)
      .post("/documents")
      .set("Authorization", `Bearer ${accessToken}`)
      .field("documentType", "certificate")
      .field("title", "Download Test")
      .attach("file", PDF_BYTES, { filename: "cert.pdf", contentType: "application/pdf" });

    const download = await request(app)
      .get(`/documents/${created.body.id}/download`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(download.status).toBe(200);
    expect(Buffer.compare(download.body, PDF_BYTES)).toBe(0);
  });
});
