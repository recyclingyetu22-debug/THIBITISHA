import { finding, type Finding } from "../finding.js";

// Layer 9 (spec §15/§34). The verification engine only ever talks to this
// interface — never a specific vendor — so a real vision-model provider can
// be dropped in later purely via configuration (getAIAnalysisProvider below)
// without touching the orchestrator or anything that calls it. Proven by
// test/aiProviderSwap.test.ts, which injects a mock provider.
export type AIDetermination = "NO_DETERMINATION" | "NO_SIGNIFICANT_INDICATORS" | "INDICATORS_DETECTED";

export interface AIAnalysisInput {
  buffer: Buffer;
  mimeType: string;
  extractedText: string | null;
  // Metadata strings already pulled out by earlier analysis layers (PDF
  // Producer/Creator, image EXIF Software, ...) — passed in rather than
  // re-parsed here, so this module stays decoupled from PDF/image-specific
  // parsing and is easy to keep provider-agnostic.
  metadataHints: string[];
}

export interface AIAnalysisFinding {
  description: string;
  evidence?: Record<string, unknown>;
}

export interface AIAnalysisResult {
  determination: AIDetermination;
  confidence: number | null;
  findings: AIAnalysisFinding[];
  provider: string;
  providerVersion: string;
  analyzedAt: string;
}

export interface AIAnalysisProvider {
  readonly name: string;
  readonly version: string;
  analyze(input: AIAnalysisInput): Promise<AIAnalysisResult>;
}

const AI_TOOL_SIGNATURE_PATTERN =
  /midjourney|stable diffusion|dall-?e|runway ?ml|adobe firefly|leonardo\.?ai|synthesia|craiyon|stability ?ai/i;

// Metadata-trace-only. This is a real limitation, not a placeholder pretending
// to be more capable: it can only ever *confirm presence* of a known AI-tool
// signature left in file metadata (easily stripped by anyone who wants to
// hide it), never confirm absence. So it must never claim
// NO_SIGNIFICANT_INDICATORS — that would overstate what a metadata check can
// actually establish. NO_DETERMINATION is the honest answer when no
// signature is found (spec's explicit instruction: never invent a negative).
export class HeuristicAIAnalysisProvider implements AIAnalysisProvider {
  readonly name = "heuristic";
  readonly version = "1.0.0";

  async analyze(input: AIAnalysisInput): Promise<AIAnalysisResult> {
    const matchedHint = input.metadataHints.find((hint) => AI_TOOL_SIGNATURE_PATTERN.test(hint));

    if (matchedHint) {
      return {
        determination: "INDICATORS_DETECTED",
        confidence: 0.5,
        findings: [
          {
            description: `Document metadata references a known AI-generation/editing tool ("${matchedHint}").`,
            evidence: { matchedHint },
          },
        ],
        provider: this.name,
        providerVersion: this.version,
        analyzedAt: new Date().toISOString(),
      };
    }

    return {
      determination: "NO_DETERMINATION",
      confidence: null,
      findings: [],
      provider: this.name,
      providerVersion: this.version,
      analyzedAt: new Date().toISOString(),
    };
  }
}

const providers: Record<string, () => AIAnalysisProvider> = {
  heuristic: () => new HeuristicAIAnalysisProvider(),
};

// Configured via AI_ANALYSIS_PROVIDER (env.ts) — deliberately a plain string
// with a safe fallback, not a closed enum, so adding a real provider later
// doesn't require a schema/type change here, only a new entry in `providers`.
export function getAIAnalysisProvider(configuredName: string): AIAnalysisProvider {
  return (providers[configuredName] ?? providers.heuristic)();
}

const MODULE_PREFIX = "aiIndicators";

export async function analyzeAiIndicators(provider: AIAnalysisProvider, input: AIAnalysisInput): Promise<Finding[]> {
  const result = await provider.analyze(input);
  const module = `${MODULE_PREFIX}:${result.provider}`;

  if (result.determination === "NO_DETERMINATION") {
    return [
      finding({
        category: "AI_INDICATOR",
        severity: "INFO",
        confidence: null,
        description: "AI-generation/editing analysis could not reach a determination with the available provider.",
        evidence: { provider: result.provider, providerVersion: result.providerVersion },
        page: null,
        regions: null,
        module,
      }),
    ];
  }

  if (result.determination === "NO_SIGNIFICANT_INDICATORS") {
    return [
      finding({
        category: "AI_INDICATOR",
        severity: "INFO",
        confidence: result.confidence,
        description: "No significant AI-generation/editing indicators detected.",
        evidence: { provider: result.provider, providerVersion: result.providerVersion },
        page: null,
        regions: null,
        module,
      }),
    ];
  }

  return result.findings.map((f) =>
    finding({
      category: "AI_INDICATOR",
      severity: "MEDIUM",
      confidence: result.confidence,
      description: f.description,
      evidence: { ...f.evidence, provider: result.provider, providerVersion: result.providerVersion },
      page: null,
      regions: null,
      module,
    }),
  );
}
