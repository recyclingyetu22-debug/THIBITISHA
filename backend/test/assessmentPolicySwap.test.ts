import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { submitVerification } from "../src/modules/verification/verification.service.js";
import type { AssessmentContext, AssessmentOutcome, AssessmentPolicy } from "../src/modules/verification/assessment.js";
import { makePdfWithText } from "./fixtures.js";

const app = createApp();

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

// Proves the assessment engine is a replaceable policy, not hard-coded
// severity rules baked into the service — a future weighted/learned
// fraud-risk model can implement this same interface without the service or
// orchestrator changing at all.
class AlwaysSuspiciousPolicy implements AssessmentPolicy {
  readonly name = "always-suspicious-test-policy";

  assess(_context: AssessmentContext): AssessmentOutcome {
    return {
      status: "SUSPICIOUS",
      summary: "Test policy always returns SUSPICIOUS regardless of findings.",
      recommendation: "This is a test policy, not the production rule set.",
    };
  }
}

describe("assessment policy is swappable", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("uses the injected policy's outcome instead of the default rule-based one", async () => {
    const email = uniqueEmail("assessment-swap");
    const registerRes = await request(app).post("/auth/register-organization").send({
      organizationName: "Assessment Swap Test Org",
      adminName: "Admin",
      email,
      password: "correct-horse-battery",
    });
    const organizationId = registerRes.body.organization.id as string;
    const userId = registerRes.body.user.id as string;

    // A clean document that the default policy would call LOW_CONCERN.
    const pdf = await makePdfWithText(["A plain, unremarkable document."]);

    const outcome = await submitVerification(
      organizationId,
      userId,
      { buffer: pdf, mimetype: "application/pdf", originalname: "plain.pdf" },
      null,
      "WEB",
      { assessmentPolicy: new AlwaysSuspiciousPolicy() },
    );

    expect(outcome.status).toBe("SUSPICIOUS");
    expect(outcome.summary).toBe("Test policy always returns SUSPICIOUS regardless of findings.");
  });
});
