import { CertificateMarks } from "./DocumentPaper.js";
import { BoundingBoxMarker, MagnifierMarker, MetadataTag, SignatureMarker, SuspiciousRegionMarker, TypographyMarker } from "./AnnotationMarkers.js";
import { Badge } from "../components/Badge.js";
import { CheckCircle2 } from "lucide-react";

// The signature hero visual: a fictional certificate displayed at a slight
// angle with several forensic inspection layers drawn around it — most
// annotations are routine/informative (brand tone), one is flagged
// (danger tone, pulsing), to tell the "here's what examination looks like,
// and here's the one thing worth a closer look" story at a glance.
export function HeroForensicVisual() {
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 600 }}>
      <svg viewBox="0 0 600 480" style={{ width: "100%", height: "auto" }} role="img" aria-label="A fictional certificate under forensic examination, with annotated regions for typography, image content, signature, and one suspicious area">
        <g transform="translate(110 20) rotate(-6 150 200)">
          <CertificateMarks />
        </g>

        <TypographyMarker x={420} y={250} width={80} label="TYPOGRAPHY" />
        <BoundingBoxMarker x={40} y={160} width={70} height={55} label="IMAGE REGION" />
        <SignatureMarker x={150} y={350} width={95} height={45} label="SIGNATURE" />
        <SuspiciousRegionMarker x={325} y={150} width={75} height={50} label="SUSPICIOUS AREA" />
        <MagnifierMarker lensX={520} lensY={340} r={30} targetX={358} targetY={375} label="MAGNIFIED" />
        <MetadataTag x={520} y={60} label="2 FINDINGS" />
      </svg>

      <div style={{ position: "absolute", left: 8, bottom: 4, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Badge label="Structure checked" tone="clear" icon={<CheckCircle2 size={12} />} />
        <Badge label="Text checked" tone="clear" icon={<CheckCircle2 size={12} />} />
        <Badge label="Metadata checked" tone="clear" icon={<CheckCircle2 size={12} />} />
      </div>
    </div>
  );
}
