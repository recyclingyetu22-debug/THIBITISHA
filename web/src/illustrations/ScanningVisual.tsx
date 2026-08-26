import { CertificateMarks } from "./DocumentPaper.js";
import { BoundingBoxMarker, TypographyMarker } from "./AnnotationMarkers.js";

// Shown next to the real ProgressSteps list while a submission is in
// flight — a document with a slow scan-line sweep and a couple of
// annotation markers fading in, purely atmospheric. The text step list
// remains the actual source of truth for what's happening; this never
// claims to represent literal real-time backend phases.
export function ScanningVisual() {
  return (
    <svg viewBox="0 0 300 400" width="180" height="240" role="img" aria-label="A document being examined">
      <CertificateMarks />
      <rect x={18} y={20} width={264} height={6} fill="var(--brand-primary)" opacity={0.55} className="scan-line" />
      <g style={{ animation: "fadeIn 0.6s ease 0.7s both" }}>
        <TypographyMarker x={190} y={244} width={40} label="TEXT" />
      </g>
      <g style={{ animation: "fadeIn 0.6s ease 1.6s both" }}>
        <BoundingBoxMarker x={30} y={330} width={60} height={40} label="SIGNATURE" />
      </g>
    </svg>
  );
}
