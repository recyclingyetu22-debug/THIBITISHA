import { CertificateMarks } from "./DocumentPaper.js";
import { BoundingBoxMarker, MetadataTag, SuspiciousRegionMarker, TypographyMarker } from "./AnnotationMarkers.js";

const CATEGORIES = [
  { label: "TYPOGRAPHY", caption: "We check whether fonts, sizes, and spacing stay consistent throughout the document." },
  { label: "IMAGE MANIPULATION", caption: "We look for signs that part of an image was copied, pasted, or otherwise edited." },
  { label: "STRUCTURAL ANOMALY", caption: "We examine the document's internal structure for unusual edits or software fingerprints." },
  { label: "SUSPICIOUS REGION", caption: "We flag specific areas — like signatures, seals, or photos — that show signs of tampering." },
  { label: "AI INDICATOR", caption: "We check for signals that part of the document may have been created or altered using AI tools." },
];

export function WhatWeLookForVisual() {
  return (
    <div className="what-we-look-for">
      <svg viewBox="0 0 480 460" style={{ width: "100%", height: "auto", maxWidth: 420 }} role="img" aria-label="A fictional document annotated with five categories of forensic examination">
        <g transform="translate(90 20)">
          <CertificateMarks />
        </g>
        <TypographyMarker x={20} y={270} width={50} label="TYPOGRAPHY" />
        <BoundingBoxMarker x={400} y={330} width={70} height={55} label="IMAGE MANIPULATION" />
        <BoundingBoxMarker x={400} y={40} width={70} height={40} label="STRUCTURAL ANOMALY" />
        <SuspiciousRegionMarker x={20} y={150} width={70} height={50} label="SUSPICIOUS REGION" />
        <MetadataTag x={430} y={230} label="AI INDICATOR" />
      </svg>

      <div className="what-we-look-for-legend">
        {CATEGORIES.map((c) => (
          <div key={c.label} className="wwlf-item">
            <h4>{c.label}</h4>
            <p className="card-subtext" style={{ marginBottom: 0 }}>{c.caption}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
