import { useState } from "react";
import { ChevronDown, ChevronUp, MapPin } from "lucide-react";
import { Badge } from "./Badge.js";
import { SEVERITY_COPY } from "../lib/statusCopy.js";
import { explainFinding } from "../lib/explanations.js";
import type { FindingCategory, FindingView } from "../lib/api/types.js";

interface ExplainedFindingProps {
  finding: FindingView;
  category: FindingCategory;
  /** executive = plain-language only (Verification Client). forensic = adds a
   *  "Technical details" disclosure with the raw detector output
   *  (Investigator Workspace). Both render the same plain-language headline. */
  mode?: "executive" | "forensic";
  selected?: boolean;
  onClick?: () => void;
}

export function ExplainedFinding({ finding, category, mode = "executive", selected, onClick }: ExplainedFindingProps) {
  const [showTechnical, setShowTechnical] = useState(false);
  const copy = explainFinding(finding, category);
  const severity = SEVERITY_COPY[finding.severity];

  return (
    <div
      className={`finding-row${selected ? " selected" : ""}`}
      onClick={onClick}
      style={onClick ? { cursor: "pointer" } : undefined}
    >
      <div className="finding-meta">
        <Badge label={severity.label} tone={severity.tone} />
        {mode === "forensic" ? <span className="mono">{finding.module}</span> : null}
        {finding.confidence !== null && mode === "forensic" ? <span>{Math.round(finding.confidence * 100)}% confidence</span> : null}
      </div>
      <div className="finding-title">{copy.title}</div>
      <p style={{ margin: "0 0 6px 0" }}>{copy.what}</p>
      <div className="finding-where">
        <MapPin size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
        {copy.where}
      </div>

      {mode === "forensic" ? (
        <>
          <div
            className="why-btn"
            onClick={(e) => {
              e.stopPropagation();
              setShowTechnical((v) => !v);
            }}
          >
            {showTechnical ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            Technical details
          </div>
          {showTechnical ? (
            <dl className="tech-details">
              <dt>Detector module</dt>
              <dd className="mono">{finding.module}</dd>
              <dt>Raw description</dt>
              <dd>{finding.description}</dd>
              {finding.confidence !== null ? (
                <>
                  <dt>Confidence</dt>
                  <dd>{Math.round(finding.confidence * 100)}%</dd>
                </>
              ) : null}
              {finding.regions && finding.regions.length > 0 ? (
                <>
                  <dt>Highlighted regions</dt>
                  <dd>{finding.regions.length} region(s) on this page</dd>
                </>
              ) : null}
            </dl>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
