import { finding, type Finding } from "../finding.js";

const MODULE = "textConsistency";
const MAX_NEAR_DUPLICATE_DISTANCE = 2;
const MIN_PHRASE_LENGTH = 6; // chars — avoids flagging short/common capitalized words

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)]);
  for (let j = 0; j < cols; j++) dp[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[rows - 1][cols - 1];
}

// Extracts "name-like" phrases: two or more consecutive capitalized words
// (e.g. "John Smith", "Kampala City"). A deliberately simple heuristic, not
// NLP-based named-entity recognition.
function extractNamePhrases(text: string): string[] {
  const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) ?? [];
  return [...new Set(matches)];
}

// Layer 4, deliberately narrow for this increment: only the concrete case
// the spec itself gives as an example — the same name appearing with a
// small, likely-typo-sized variation in different places in the document
// (spec §10: "John Smith" vs "John Smit"). Generic date/amount/field
// consistency checking needs to know which values represent "the same
// field," which requires document-type-specific parsing this increment
// deliberately doesn't build yet (a generic "multiple dates found" check
// would false-positive on nearly every real document, which contradicts
// "never invent findings the evidence doesn't support").
export function analyzeTextConsistency(text: string): Finding[] {
  const phrases = extractNamePhrases(text);
  const findings: Finding[] = [];
  const flaggedPairs = new Set<string>();

  for (let i = 0; i < phrases.length; i++) {
    for (let j = i + 1; j < phrases.length; j++) {
      const a = phrases[i];
      const b = phrases[j];
      if (a === b || Math.min(a.length, b.length) < MIN_PHRASE_LENGTH) continue;

      const distance = levenshtein(a, b);
      if (distance > 0 && distance <= MAX_NEAR_DUPLICATE_DISTANCE) {
        const key = [a, b].sort().join("|");
        if (flaggedPairs.has(key)) continue;
        flaggedPairs.add(key);

        findings.push(
          finding({
            category: "TEXT_CONSISTENCY",
            severity: "MEDIUM",
            confidence: null,
            description: `Two near-identical names/phrases appear in the document with a small difference — possibly a typo, or an inconsistency worth checking ("${a}" vs "${b}").`,
            evidence: { phraseA: a, phraseB: b, editDistance: distance },
            page: null,
            regions: null,
            module: MODULE,
          }),
        );
      }
    }
  }

  return findings;
}
