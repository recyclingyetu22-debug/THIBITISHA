import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";

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

const PDF_BYTES = Buffer.from("%PDF-1.4\n%concurrency test file\n%%EOF", "latin1");

function sequenceOf(documentNumber: string): number {
  const match = /^DOC-\d{4}-(\d{8})$/.exec(documentNumber);
  if (!match) throw new Error(`Unexpected document number format: ${documentNumber}`);
  return Number(match[1]);
}

describe("document number concurrency", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("never assigns the same sequence number to two documents registered simultaneously by different organizations", async () => {
    // documentNumber is globally unique (spec: it must work as a standalone
    // public lookup key later, independent of which org issued it), so the
    // real risk is two orgs' concurrent requests both reading the same
    // "current" counter value and computing the same next number. This
    // fires N requests from 3 different organizations at once — genuinely
    // concurrent at the DB level, not sequential awaits — and asserts the
    // atomic upsert-increment in nextDocumentNumber() (documentNumber.ts)
    // serializes them correctly.
    const tokens = await Promise.all([
      registerOrg("Concurrency Org A"),
      registerOrg("Concurrency Org B"),
      registerOrg("Concurrency Org C"),
    ]);

    const REQUEST_COUNT = 24;
    const responses = await Promise.all(
      Array.from({ length: REQUEST_COUNT }, (_, i) =>
        request(app)
          .post("/documents")
          .set("Authorization", `Bearer ${tokens[i % tokens.length]}`)
          .field("documentType", "certificate")
          .field("title", `Concurrent Document ${i}`)
          .attach("file", PDF_BYTES, { filename: `concurrent-${i}.pdf`, contentType: "application/pdf" }),
      ),
    );

    for (const res of responses) {
      expect(res.status).toBe(201);
    }

    const sequences = responses.map((res) => sequenceOf(res.body.documentNumber));
    const uniqueSequences = new Set(sequences);

    // The real assertion: no collisions under concurrency.
    expect(uniqueSequences.size).toBe(REQUEST_COUNT);

    // Nothing else touches the counter while this test's Promise.all is in
    // flight, so the batch should also be gapless/contiguous — a stronger
    // check that no transaction silently skipped or double-consumed a value.
    const sorted = [...sequences].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]).toBe(sorted[i - 1] + 1);
    }
  });
});
