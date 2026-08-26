import { FormMarks } from "./DocumentPaper.js";
import { SuspiciousRegionMarker } from "./AnnotationMarkers.js";

export function BeforeAfterVisual() {
  return (
    <div>
      <div className="before-after-row">
        <div className="before-after-panel">
          <h4>ORIGINAL</h4>
          <svg viewBox="0 0 320 240" style={{ width: "100%", height: "auto" }} role="img" aria-label="A clean, unmodified fictional invoice">
            <FormMarks total="$1,240.00" />
          </svg>
          <p className="card-subtext" style={{ marginBottom: 0 }}>The document as issued.</p>
        </div>

        <div className="before-after-panel">
          <h4>ALTERED</h4>
          <svg viewBox="0 0 320 240" style={{ width: "100%", height: "auto" }} role="img" aria-label="The same fictional invoice with its total amount changed">
            <FormMarks total="$9,240.00" />
          </svg>
          <p className="card-subtext" style={{ marginBottom: 0 }}>The total was changed. At a glance, it looks the same as any other invoice.</p>
        </div>

        <div className="before-after-panel">
          <h4>THIBITISHA</h4>
          <svg viewBox="0 0 320 240" style={{ width: "100%", height: "auto" }} role="img" aria-label="The altered invoice with the changed total highlighted as a suspicious region">
            <FormMarks total="$9,240.00" />
            <SuspiciousRegionMarker x={205} y={176} width={100} height={24} label="AMOUNT CHANGED" />
          </svg>
          <p className="card-subtext" style={{ marginBottom: 0 }}>The changed field is flagged, with the reason it was flagged.</p>
        </div>
      </div>

      <div className="disclaimer" style={{ marginTop: 20 }}>
        This is one example of one detector catching one kind of change — not a
        claim that THIBITISHA catches every forgery. It surfaces evidence for a
        human to review, the same discipline behind every result in the product.
      </div>
    </div>
  );
}
