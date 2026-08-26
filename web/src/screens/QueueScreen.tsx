import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Inbox, ShieldCheck } from "lucide-react";
import { listVerifications } from "../lib/api/verifications.js";
import { Badge } from "../components/Badge.js";
import { EmptyState } from "../components/EmptyState.js";
import { LoadingState } from "../components/LoadingState.js";
import { Alert } from "../components/Alert.js";
import { ASSESSMENT_STATUS_COPY, REVIEW_DECISION_COPY } from "../lib/statusCopy.js";
import type { ReviewStatusFilter } from "../lib/api/types.js";

const FILTER_OPTIONS: Array<{ value: ReviewStatusFilter | "ALL"; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "NOT_REVIEWED", label: "Not reviewed" },
  { value: "IN_REVIEW", label: "In review" },
  { value: "CONFIRMED_AUTHENTIC", label: "Confirmed authentic" },
  { value: "CONFIRMED_MODIFICATION", label: "Confirmed modification" },
  { value: "INSUFFICIENT_EVIDENCE", label: "Insufficient evidence" },
  { value: "REQUEST_MORE_INFORMATION", label: "More information requested" },
  { value: "FALSE_POSITIVE", label: "False positive" },
];

export function QueueScreen() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<ReviewStatusFilter | "ALL">("ALL");

  const { data, isLoading, error } = useQuery({
    queryKey: ["verifications-queue", filter],
    queryFn: () => listVerifications(filter === "ALL" ? undefined : filter),
  });

  return (
    <div>
      <div className="page-header">
        <span className="eyebrow">
          <ShieldCheck size={13} /> Investigator workspace
        </span>
        <h1>Verification queue</h1>
        <p className="card-subtext" style={{ marginBottom: 0 }}>
          Every verification submitted by your organization.
        </p>
      </div>

      <div className="filter-bar">
        <label htmlFor="reviewStatusFilter" className="card-subtext" style={{ margin: 0 }}>
          Review status
        </label>
        <select id="reviewStatusFilter" value={filter} onChange={(e) => setFilter(e.target.value as ReviewStatusFilter | "ALL")}>
          {FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? <LoadingState label="Loading queue…" /> : null}
      {error ? <Alert tone="danger">Could not load the queue.</Alert> : null}
      {data && data.length === 0 ? <EmptyState icon={<Inbox size={24} />} title="Nothing matches this filter" subtext="Try a different review status, or check back once more documents are submitted." /> : null}

      {data && data.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Submitted</th>
                <th>Assessment</th>
                <th>Review status</th>
                <th>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {data.map((v) => {
                const assessmentCopy = v.assessment ? ASSESSMENT_STATUS_COPY[v.assessment.status] : null;
                const reviewCopy = REVIEW_DECISION_COPY[v.reviewStatus];
                return (
                  <tr key={v.id} onClick={() => navigate(`/investigation/${v.id}`)}>
                    <td>{v.originalFilename}</td>
                    <td>{new Date(v.createdAt).toLocaleString()}</td>
                    <td>{assessmentCopy ? <Badge label={assessmentCopy.label} tone={assessmentCopy.tone} /> : "—"}</td>
                    <td>
                      <Badge label={reviewCopy.label} tone={reviewCopy.tone} />
                    </td>
                    <td>
                      {v.coverageIncomplete ? (
                        <span style={{ color: "var(--status-caution-fg)", fontWeight: 600 }}>Incomplete</span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--text-muted)" }}>
                          <CheckCircle2 size={13} /> Complete
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
