import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { submitVerification } from "../src/modules/verification/verification.service.js";
import type { AIAnalysisInput, AIAnalysisProvider, AIAnalysisResult } from "../src/modules/verification/analysis/aiIndicators.js";
import { makePdfWithText } from "./fixtures.js";

const app = createApp();

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

// Proves the verification engine only depends on the AIAnalysisProvider
// interface, never a concrete implementation (spec §15/§34) — this mock
// shares no code with HeuristicAIAnalysisProvider, yet its finding surfaces
// in the result unchanged, through the same orchestrator/service code path.
class MockAIAnalysisProvider implements AIAnalysisProvider {
  readonly name = "mock-vision-provider";
  readonly version = "0.0.1-test";

  async analyze(_input: AIAnalysisInput): Promise<AIAnalysisResult> {
    return {
      determination: "INDICATORS_DETECTED",
      confidence: 0.93,
      findings: [{ description: "Mock provider always flags this test document.", evidence: { mock: true } }],
      provider: this.name,
      providerVersion: this.version,
      analyzedAt: new Date().toISOString(),
    };
  }
}

describe("AI analysis provider is swappable", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("surfaces the injected provider's finding without any orchestrator/service change", async () => {
    const email = uniqueEmail("ai-swap");
    const registerRes = await request(app).post("/auth/register-organization").send({
      organizationName: "AI Swap Test Org",
      adminName: "Admin",
      email,
      password: "correct-horse-battery",
    });
    const organizationId = registerRes.body.organization.id as string;
    const userId = registerRes.body.user.id as string;

    const pdf = await makePdfWithText(["A plain document with nothing unusual in it."]);

    const outcome = await submitVerification(
      organizationId,
      userId,
      { buffer: pdf, mimetype: "application/pdf", originalname: "plain.pdf" },
      null,
      "WEB",
      { aiProvider: new MockAIAnalysisProvider() },
    );

    const aiFinding = outcome.findings.find((f) => f.category === "AI_INDICATOR");
    expect(aiFinding).toBeDefined();
    expect(aiFinding?.module).toBe("aiIndicators:mock-vision-provider");
    expect(aiFinding?.description).toContain("Mock provider always flags this test document.");
    expect(aiFinding?.confidence).toBe(0.93);
  });
});
