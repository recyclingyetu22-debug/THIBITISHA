import { detectFileType, isDeclaredMimeConsistent, isExtensionConsistent, type DetectedFileType } from "../../../lib/fileType.js";
import { finding, type Finding } from "../finding.js";

const MODULE = "fileIntegrity";

export class UnsupportedFileError extends Error {}

// Layer 1 (spec §7). Cheap, synchronous, runs before anything else — this is
// the gate that decides whether deeper analysis is even attempted. Reuses
// Phase 1's magic-byte detection (lib/fileType.ts) rather than trusting the
// client-declared Content-Type/extension.
export function analyzeFileIntegrity(
  buffer: Buffer,
  declaredMimeType: string,
  filename: string,
): { detected: DetectedFileType; findings: Finding[] } {
  const detected = detectFileType(buffer);
  if (!detected) {
    throw new UnsupportedFileError("Unsupported or unrecognized file type");
  }

  const findings: Finding[] = [];

  const mimeConsistent = isDeclaredMimeConsistent(detected, declaredMimeType);
  const extensionConsistent = isExtensionConsistent(detected, filename);

  if (!mimeConsistent || !extensionConsistent) {
    findings.push(
      finding({
        category: "FILE_INTEGRITY",
        severity: "HIGH",
        confidence: null,
        description: "The file's actual content does not match its declared type or extension.",
        evidence: { detected, declaredMimeType, filename, mimeConsistent, extensionConsistent },
        page: null,
        regions: null,
        module: MODULE,
      }),
    );
  }

  return { detected, findings };
}
