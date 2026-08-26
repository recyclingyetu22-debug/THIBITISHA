import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileSearch, HelpCircle, ShieldAlert, ShieldCheck } from "lucide-react";
import { getVerificationReport } from "../lib/api/verifications.js";
import { Badge } from "../components/Badge.js";
import { WhyButton } from "../components/WhyButton.js";
import { ExplainedFinding } from "../components/ExplainedFinding.js";
import { LoadingState } from "../components/LoadingState.js";
import { Alert } from "../components/Alert.js";
import { ASSESSMENT_STATUS_COPY, ISSUER_CONFIRMATION_COPY, type Tone } from "../lib/statusCopy.js";
import type { FindingCategory, FindingView } from "../lib/api/types.js";

const TONE_ICON: Record<Tone, typeof ShieldCheck> = {
  clear: CheckCircle2,
  caution: AlertTriangle,
  danger: ShieldAlert,
  info: HelpCircle,
  match: ShieldCheck,
};

// keyFindings arrives flat (top N across categories) without its own
// category tag — build a lookup from the grouped `findings` record once so
// each key finding can still be explained via its category's plain-language
// copy (see lib/explanations.ts).
function buildCategoryLookup(findings: Record<string, FindingView[]>): Map<string, FindingCategory> {
  const map = new Map<string, FindingCategory>();
  for (const [category, list] of Object.entries(findings)) {
    for (const f of list) {
      map.set(`${f.module}|${f.page}|${f.description}`, category as FindingCategory);
    }
  }
  return map;
}

export function VerifyResultScreen() {
  const { id } = useParams<{ id: string }>();
  const {
    data: report,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["verification-report", id],
    queryFn: () => getVerificationReport(id!),
    enabled: Boolean(id),
  });
  const [showAllFindings, setShowAllFindings] = useState(false);

  if (isLoading) return <LoadingState label="Loading verification…" />;
  if (error || !report) return <Alert tone="danger">Could not load this verification.</Alert>;

  const assessmentCopy = report.overallAssessment ? ASSESSMENT_STATUS_COPY[report.overallAssessment.status] : null;
  const issuerCopy = ISSUER_CONFIRMATION_COPY[report.issuerConfirmation.status];
  const ToneIcon = assessmentCopy ? TONE_ICON[assessmentCopy.tone] : HelpCircle;
  const categoryLookup = buildCategoryLookup(report.findings);
  const totalFindingCount = Object.values(report.findings).flat().length;

  return (
    <div>
      <div className="page-header">
        <span className="eyebrow">
          <FileSearch size={13} /> Verification result
        </span>
        <h1>{report.document.filename}</h1>
        <p className="card-subtext" style={{ marginBottom: 0 }}>
          Analyzed {new Date(report.document.analyzedAt).toLocaleString()}
        </p>
      </div>

      {assessmentCopy ? (
        <div className={`status-hero tone-${assessmentCopy.tone} fade-in`}>
          <span className="status-hero-icon">
            <ToneIcon size={22} />
          </span>
          <div>
            <p className="status-hero-title">{assessmentCopy.label}</p>
            <WhyButton why={assessmentCopy.why} />
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-heading">
          <h2>Explanation</h2>
          <span className="kind">automated</span>
        </div>
        <p>{report.executiveSummary}</p>
        {report.recommendation ? <div className="disclaimer">{report.recommendation}</div> : null}

        {report.issuerConfirmation.status !== "NOT_REQUESTED" ? (
          <p className="card-subtext" style={{ marginBottom: 0 }}>
            Issuer confirmation: <Badge label={issuerCopy.label} tone={issuerCopy.tone} />
          </p>
        ) : null}
      </div>

      <div className="card">
        <div className="card-heading">
          <h2>Evidence</h2>
        </div>
        {report.keyFindings.length === 0 ? (
          <p className="card-subtext">No notable findings were produced by this analysis.</p>
        ) : (
          report.keyFindings.map((finding, i) => (
            <ExplainedFinding
              key={i}
              finding={finding}
              category={categoryLookup.get(`${finding.module}|${finding.page}|${finding.description}`) ?? "PDF_STRUCTURE"}
            />
          ))
        )}

        {totalFindingCount > 0 ? (
          <>
            <div className="collapsible-header" onClick={() => setShowAllFindings((v) => !v)}>
              <span className="card-subtext" style={{ margin: 0 }}>
                {showAllFindings ? "Hide" : "View"} all findings ({totalFindingCount})
              </span>
            </div>
            {showAllFindings
              ? Object.entries(report.findings).map(([category, findings]) => (
                  <div key={category} style={{ marginTop: 14 }}>
                    <h4 style={{ marginBottom: 8 }}>{category.replace(/_/g, " ")}</h4>
                    {findings.map((finding, i) => (
                      <ExplainedFinding key={i} finding={finding} category={category as FindingCategory} />
                    ))}
                  </div>
                ))
              : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
