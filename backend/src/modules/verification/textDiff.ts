import { diffWords, type Change } from "diff";
import { createHash } from "node:crypto";

export interface TextDiffSpan {
  value: string;
  added?: boolean;
  removed?: boolean;
}

// Collapses whitespace and casefolds so the fingerprint (and the "did the
// *content* actually change" check) isn't tripped up by re-wrapped lines or
// inconsistent capitalization from re-scanning/re-saving — only real content
// changes should register (spec §68: copy ≠ fake). Never shown to a user
// directly — display diffs come from diffText() below, on the raw text, so
// the actual casing/spacing of what changed is still visible in the report.
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function textFingerprintHash(text: string): string {
  return createHash("sha256").update(normalizeText(text)).digest("hex");
}

// Diffs the raw (non-normalized) text so the returned spans show real
// casing/whitespace — this is what a reviewer actually reads.
export function diffText(originalText: string, submittedText: string): TextDiffSpan[] {
  const changes: Change[] = diffWords(originalText, submittedText);
  return changes
    .filter((c) => c.added || c.removed)
    .map((c) => ({ value: c.value, added: c.added, removed: c.removed }));
}

// Classification uses the *normalized* comparison so whitespace/case-only
// noise from re-scanning doesn't get flagged as MODIFIED — but the spans
// shown to the user (diffText, above) still carry the real text.
export function hasSignificantTextDifference(originalText: string, submittedText: string): boolean {
  return normalizeText(originalText) !== normalizeText(submittedText);
}
