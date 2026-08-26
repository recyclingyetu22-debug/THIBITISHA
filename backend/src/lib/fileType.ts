// Minimal magic-byte sniffing for the document types Phase 1 accepts.
// Deliberately narrow (spec §5/§86): we only need to confirm the uploaded
// bytes actually are what the client's Content-Type/extension claim.

export type DetectedFileType = "pdf" | "jpg" | "png" | "tiff";

const SIGNATURES: Array<{ type: DetectedFileType; mimeTypes: string[]; extensions: string[]; matches: (buf: Buffer) => boolean }> = [
  {
    type: "pdf",
    mimeTypes: ["application/pdf"],
    extensions: [".pdf"],
    matches: (buf) => buf.subarray(0, 5).toString("latin1") === "%PDF-",
  },
  {
    type: "jpg",
    mimeTypes: ["image/jpeg", "image/jpg"],
    extensions: [".jpg", ".jpeg"],
    matches: (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
  {
    type: "png",
    mimeTypes: ["image/png"],
    extensions: [".png"],
    matches: (buf) =>
      buf.length >= 8 &&
      buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    type: "tiff",
    mimeTypes: ["image/tiff"],
    extensions: [".tif", ".tiff"],
    matches: (buf) =>
      buf.length >= 4 &&
      ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) ||
        (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a)),
  },
];

export function detectFileType(buffer: Buffer): DetectedFileType | null {
  for (const sig of SIGNATURES) {
    if (sig.matches(buffer)) return sig.type;
  }
  return null;
}

export function isDeclaredMimeConsistent(detected: DetectedFileType, declaredMime: string): boolean {
  const sig = SIGNATURES.find((s) => s.type === detected);
  return sig ? sig.mimeTypes.includes(declaredMime.toLowerCase()) : false;
}

export function isExtensionConsistent(detected: DetectedFileType, filename: string): boolean {
  const sig = SIGNATURES.find((s) => s.type === detected);
  if (!sig) return false;
  const lower = filename.toLowerCase();
  return sig.extensions.some((ext) => lower.endsWith(ext));
}
