import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  FileSearch,
  FileText,
  Gavel,
  HelpCircle,
  History,
  Layers,
  Link2,
  Send,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { getInvestigation, postIssuerConfirmation, postReviewDecision } from "../lib/api/verifications.js";
import { Card } from "../components/Card.js";
import { Badge } from "../components/Badge.js";
import { Button } from "../components/Button.js";
import { WhyButton } from "../components/WhyButton.js";
import { ExplainedFinding } from "../components/ExplainedFinding.js";
import { LoadingState } from "../components/LoadingState.js";
import { Alert } from "../components/Alert.js";
import { PageViewer, type OverlayRegion } from "../components/PageViewer.js";
import {
  ALL_ISSUER_CONFIRMATION_STATUSES,
  ALL_REVIEW_DECISION_STATUSES,
  ASSESSMENT_STATUS_COPY,
  ISSUER_CONFIRMATION_COPY,
  REVIEW_DECISION_COPY,
  type Tone,
} from "../lib/statusCopy.js";
import type { FindingCategory, FindingView, IssuerConfirmationStatus, ReviewDecisionStatus } from "../lib/api/types.js";

const TONE_ICON: Record<Tone, typeof ShieldCheck> = {
  clear: CheckCircle2,
  caution: AlertTriangle,
  danger: ShieldAlert,
  info: HelpCircle,
  match: ShieldCheck,
};

function findingKey(category: string, index: number): string {
  return `${category}-${index}`;
}

export function InvestigationScreen() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [pageNumber, setPageNumber] = useState(1);
  const [selectedFindingKey, setSelectedFindingKey] = useState<string | null>(null);
  const [showAuditHistory, setShowAuditHistory] = useState(false);

  const {
    data: investigation,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["investigation", id],
    queryFn: () => getInvestigation(id!),
    enabled: Boolean(id),
  });

  const flatFindings = useMemo(() => {
    if (!investigation) return [];
    const out: Array<{ key: string; category: FindingCategory; finding: FindingView }> = [];
    for (const [category, findings] of Object.entries(investigation.findings)) {
      findings.forEach((finding, index) => {
        out.push({ key: findingKey(category, index), category: category as FindingCategory, finding });
      });
    }
    return out;
  }, [investigation]);

  const selectedEntry = flatFindings.find((f) => f.key === selectedFindingKey) ?? null;

  const regionsForPage: OverlayRegion[] = useMemo(() => {
    const out: OverlayRegion[] = [];
    for (const entry of flatFindings) {
      if (entry.finding.page !== pageNumber || !entry.finding.regions) continue;
      entry.finding.regions.forEach((rect, rectIndex) => {
        out.push({
          key: `${entry.key}:${rectIndex}`,
          selectKey: entry.key,
          rect,
          severity: entry.finding.severity,
          selected: selectedFindingKey === entry.key,
        });
      });
    }
    return out;
  }, [flatFindings, pageNumber, selectedFindingKey]);

  const [issuerStatus, setIssuerStatus] = useState<IssuerConfirmationStatus>("REQUESTED");
  const [issuerContactMethod, setIssuerContactMethod] = useState("");
  const [issuerNotes, setIssuerNotes] = useState("");
  const issuerMutation = useMutation({
    mutationFn: () =>
      postIssuerConfirmation(id!, {
        status: issuerStatus,
        contactMethod: issuerContactMethod || undefined,
        notes: issuerNotes || undefined,
      }),
    onSuccess: () => {
      setIssuerContactMethod("");
      setIssuerNotes("");
      void queryClient.invalidateQueries({ queryKey: ["investigation", id] });
    },
  });

  const [reviewStatus, setReviewStatus] = useState<ReviewDecisionStatus>("IN_REVIEW");
  const [reviewNotes, setReviewNotes] = useState("");
  const reviewMutation = useMutation({
    mutationFn: () => postReviewDecision(id!, { status: reviewStatus, notes: reviewNotes || undefined }),
    onSuccess: () => {
      setReviewNotes("");
      void queryClient.invalidateQueries({ queryKey: ["investigation", id] });
      void queryClient.invalidateQueries({ queryKey: ["verifications-queue"] });
    },
  });

  if (isLoading) return <LoadingState label="Loading investigation…" />;
  if (error || !investigation) return <Alert tone="danger">Could not load this investigation.</Alert>;

  const assessmentCopy = investigation.overallAssessment ? ASSESSMENT_STATUS_COPY[investigation.overallAssessment.status] : null;
  const ToneIcon = assessmentCopy ? TONE_ICON[assessmentCopy.tone] : HelpCircle;
  const issuerCopy = ISSUER_CONFIRMATION_COPY[investigation.issuerConfirmation.status];
  const reviewCopy = REVIEW_DECISION_COPY[investigation.reviewDecision.status];
  const pageCount = investigation.coverage.pages.pageCount ?? 1;

  function selectFinding(key: string, finding: FindingView) {
    setSelectedFindingKey(key);
    if (finding.page !== null) setPageNumber(finding.page);
  }

  return (
    <div>
      <div className="page-header">
        <span className="eyebrow">
          <FileSearch size={13} /> Investigator workspace
        </span>
        <h1>{investigation.document.filename}</h1>
        <p className="card-subtext" style={{ marginBottom: 0 }}>
          Submitted by {investigation.document.submittedByName} on {new Date(investigation.document.analyzedAt).toLocaleString()}
          {" · "}
          <span className="hash" title={investigation.document.sha256}>
            {investigation.document.sha256.slice(0, 16)}…
          </span>
        </p>
      </div>

      <div className="investigation-grid">
        <div>
          <PageViewer
            verificationId={id!}
            pageNumber={pageNumber}
            pageCount={pageCount}
            regions={regionsForPage}
            onSelectRegion={setSelectedFindingKey}
            onPageChange={setPageNumber}
          />

          {selectedEntry ? (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ marginBottom: 8 }}>Selected finding</h4>
              <ExplainedFinding finding={selectedEntry.finding} category={selectedEntry.category} mode="executive" selected />
            </div>
          ) : null}
        </div>

        <div>
          <Card title="Forensic Assessment" kind="automated" icon={<ShieldCheck size={16} />}>
            {assessmentCopy ? (
              <div className={`status-hero tone-${assessmentCopy.tone}`} style={{ marginBottom: 16 }}>
                <span className="status-hero-icon">
                  <ToneIcon size={20} />
                </span>
                <div>
                  <p className="status-hero-title">{assessmentCopy.label}</p>
                  <WhyButton why={assessmentCopy.why} />
                </div>
              </div>
            ) : (
              <p>No assessment available.</p>
            )}
            <p>{investigation.executiveSummary}</p>
            <p className="card-subtext">Assessment confidence: {investigation.assessmentConfidence}</p>

            {investigation.limitations.length > 0 ? (
              <Alert tone="caution" icon={<AlertTriangle size={15} />}>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {investigation.limitations.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}

            <h4 style={{ marginTop: 16, marginBottom: 8 }}>Module coverage</h4>
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", fontSize: 13.5 }}>
              {investigation.coverage.modules.map((m) => (
                <li key={m.module} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6, color: "var(--text-muted)" }}>
                  {m.status === "ran" ? (
                    <CheckCircle2 size={14} style={{ marginTop: 2, color: "var(--status-clear-fg)", flexShrink: 0 }} />
                  ) : m.status === "failed" ? (
                    <XCircle size={14} style={{ marginTop: 2, color: "var(--status-danger-fg)", flexShrink: 0 }} />
                  ) : (
                    <Circle size={14} style={{ marginTop: 2, color: "var(--text-faint)", flexShrink: 0 }} />
                  )}
                  <span>
                    <strong className="mono" style={{ color: "var(--text)" }}>
                      {m.module}
                    </strong>
                    : {m.status}
                    {m.reason ? ` — ${m.reason}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Evidence & Correlated Findings" icon={<Layers size={16} />}>
            {investigation.correlatedFindings.length > 0 ? (
              <div style={{ marginBottom: 18 }}>
                <h4 style={{ marginBottom: 8 }}>
                  <Link2 size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                  Correlated findings
                </h4>
                {investigation.correlatedFindings.map((c, i) => (
                  <p key={i} className="card-subtext">
                    {c.corroborated ? "Corroborated by" : "Reported by"} {c.moduleCount} module{c.moduleCount === 1 ? "" : "s"}
                    {c.page !== null ? ` on page ${c.page}` : ""} — {c.modules.join(", ")} ({c.findingCount} finding
                    {c.findingCount === 1 ? "" : "s"})
                  </p>
                ))}
              </div>
            ) : null}
            {Object.entries(investigation.findings).map(([category, findings]) => (
              <div key={category} style={{ marginBottom: 14 }}>
                <h4 style={{ marginBottom: 8 }}>{category.replace(/_/g, " ")}</h4>
                {findings.map((finding, index) => {
                  const key = findingKey(category, index);
                  return (
                    <ExplainedFinding
                      key={key}
                      finding={finding}
                      category={category as FindingCategory}
                      mode="forensic"
                      selected={selectedFindingKey === key}
                      onClick={() => selectFinding(key, finding)}
                    />
                  );
                })}
              </div>
            ))}
          </Card>

          <Card title="Reference Comparison" icon={<FileText size={16} />}>
            {investigation.referenceComparison.available ? (
              <p style={{ marginBottom: 0 }}>Compared against reference document {investigation.referenceComparison.documentNumber}.</p>
            ) : (
              <p className="card-subtext" style={{ marginBottom: 0 }}>
                No reference document was supplied — this is a standalone analysis.
              </p>
            )}
          </Card>

          <Card title="Issuer Confirmation" kind="manual, third-party" icon={<Building2 size={16} />}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <Badge label={issuerCopy.label} tone={issuerCopy.tone} />
              <WhyButton why={issuerCopy.why} />
            </div>
            <div className="history-list" style={{ marginTop: 12 }}>
              {investigation.issuerConfirmation.history.map((event) => (
                <div key={event.id} className="history-item">
                  <Badge label={ISSUER_CONFIRMATION_COPY[event.status].label} tone={ISSUER_CONFIRMATION_COPY[event.status].tone} />
                  {" — "}
                  {new Date(event.createdAt).toLocaleString()}
                  {event.contactMethod ? ` · via ${event.contactMethod}` : ""}
                  {event.notes ? <div className="card-subtext">{event.notes}</div> : null}
                </div>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                issuerMutation.mutate();
              }}
              style={{ marginTop: 16 }}
            >
              <div className="field">
                <label htmlFor="issuerStatus">Record an event</label>
                <select id="issuerStatus" value={issuerStatus} onChange={(e) => setIssuerStatus(e.target.value as IssuerConfirmationStatus)}>
                  {ALL_ISSUER_CONFIRMATION_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {ISSUER_CONFIRMATION_COPY[s].label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="issuerContactMethod">Contact method (optional)</label>
                <input id="issuerContactMethod" value={issuerContactMethod} onChange={(e) => setIssuerContactMethod(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="issuerNotes">Notes (optional)</label>
                <textarea id="issuerNotes" value={issuerNotes} onChange={(e) => setIssuerNotes(e.target.value)} />
              </div>
              <Button type="submit" size="sm" disabled={issuerMutation.isPending}>
                <Send size={13} /> {issuerMutation.isPending ? "Recording…" : "Record event"}
              </Button>
            </form>
          </Card>

          <Card title="Reviewer Decision" kind="human judgment" icon={<Gavel size={16} />}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <Badge label={reviewCopy.label} tone={reviewCopy.tone} />
              <WhyButton why={reviewCopy.why} />
            </div>
            <div className="history-list" style={{ marginTop: 12 }}>
              {investigation.reviewDecision.history.map((event) => (
                <div key={event.id} className="history-item">
                  <Badge label={REVIEW_DECISION_COPY[event.status].label} tone={REVIEW_DECISION_COPY[event.status].tone} />
                  {" — "}
                  {new Date(event.createdAt).toLocaleString()}
                  {event.notes ? <div className="card-subtext">{event.notes}</div> : null}
                </div>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                reviewMutation.mutate();
              }}
              style={{ marginTop: 16 }}
            >
              <div className="field">
                <label htmlFor="reviewStatus">Record a decision</label>
                <select id="reviewStatus" value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value as ReviewDecisionStatus)}>
                  {ALL_REVIEW_DECISION_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {REVIEW_DECISION_COPY[s].label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="reviewNotes">Notes (optional)</label>
                <textarea id="reviewNotes" value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} />
              </div>
              <Button type="submit" size="sm" disabled={reviewMutation.isPending}>
                <Send size={13} /> {reviewMutation.isPending ? "Recording…" : "Record decision"}
              </Button>
            </form>
          </Card>

          <Card title="Audit History" icon={<History size={16} />}>
            <div className="collapsible-header" onClick={() => setShowAuditHistory((v) => !v)}>
              <span className="card-subtext" style={{ margin: 0 }}>
                {showAuditHistory ? "Hide" : "Show"} {investigation.auditHistory.length} event{investigation.auditHistory.length === 1 ? "" : "s"}
              </span>
              {showAuditHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
            {showAuditHistory ? (
              <div className="history-list" style={{ marginTop: 12 }}>
                {investigation.auditHistory.map((entry) => (
                  <div key={entry.id} className="history-item">
                    {entry.action} — {new Date(entry.createdAt).toLocaleString()}
                  </div>
                ))}
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
