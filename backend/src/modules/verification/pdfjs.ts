import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfjsDistDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
// Plain filesystem paths, NOT file:// URLs: pdfjs-dist's Node factories
// (NodeCMapReaderFactory/NodeStandardFontDataFactory) read via
// `fs.promises.readFile(url)`, which only auto-parses WHATWG URL *objects*,
// not strings that merely look like file:// URLs — passing a string here
// makes Node treat "file:///C:/..." as a literal (invalid) relative path,
// which silently fails and falls back to degraded font handling.
const standardFontDataUrl = path.join(pdfjsDistDir, "standard_fonts") + path.sep;
const cMapUrl = path.join(pdfjsDistDir, "cmaps") + path.sep;

// Node < 22 doesn't have this yet; pdfjs-dist's Node build expects it.
if (typeof (Promise as unknown as { withResolvers?: unknown }).withResolvers !== "function") {
  (Promise as unknown as { withResolvers: () => unknown }).withResolvers = function withResolvers() {
    let resolve: (value: unknown) => void;
    let reject: (reason?: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve: resolve!, reject: reject! };
  };
}

// Legacy Node build: runs on the main thread without a browser Worker.
// Exposed (not just loadPdfDocument below) so callers that need other
// exports — e.g. pdfStructure.ts's PDFDateString for metadata date parsing —
// don't need their own dynamic import of the same module.
export function loadPdfjsLib() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

export async function loadPdfDocument(buffer: Buffer) {
  const pdfjsLib = await loadPdfjsLib();
  return pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl,
    cMapUrl,
    cMapPacked: true,
    disableFontFace: true,
    useSystemFonts: false,
  }).promise;
}
