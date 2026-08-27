import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileStack, ScanSearch, Smartphone, UploadCloud } from "lucide-react";
import { listVerifications, submitVerification } from "../lib/api/verifications.js";
import { getBillingAccount } from "../lib/api/billing.js";
import { Badge } from "../components/Badge.js";
import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { EmptyState } from "../components/EmptyState.js";
import { LoadingState } from "../components/LoadingState.js";
import { ProgressSteps } from "../components/ProgressSteps.js";
import { ScanningVisual } from "../illustrations/ScanningVisual.js";
import { ASSESSMENT_STATUS_COPY } from "../lib/statusCopy.js";
import { ApiError } from "../lib/api/client.js";
import { MOBILE_APK_URL } from "../lib/constants.js";

export function VerifyHomeScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const history = useQuery({ queryKey: ["verifications"], queryFn: () => listVerifications() });
  // "No account = unlimited" mirrors the backend's own fail-open rule (see
  // entitlements.ts) — an org with no EntitlementAccount just never sees
  // any of the gating UI below.
  const billing = useQuery({ queryKey: ["billing", "account"], queryFn: () => getBillingAccount() });

  const submit = useMutation({
    mutationFn: (file: File) => submitVerification(file),
    onSuccess: (result) => navigate(`/verify/${result.id}`),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 402) {
        // Balance just ran out — refetch so the UI switches to the
        // "download the app" panel below instead of showing a raw error.
        queryClient.invalidateQueries({ queryKey: ["billing", "account"] });
        return;
      }
      setError(err instanceof ApiError ? err.message : "Could not analyze this document.");
    },
  });

  function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    submit.mutate(file);
  }

  const account = billing.data;
  const isGated = Boolean(account && account.hasAccount && !account.unlimited);
  const isExhausted = isGated && (account?.balance ?? 0) <= 0;

  return (
    <div>
      <div className="page-header">
        <span className="eyebrow">
          <ScanSearch size={13} /> Verification client
        </span>
        <h1>Verify a document</h1>
        <p className="card-subtext" style={{ marginBottom: 0 }}>
          Upload any document for a standalone forensic analysis. No prior registration is required.
        </p>
      </div>

      {isGated && !isExhausted ? (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="info">
            {account?.balance} free web {account?.balance === 1 ? "verification" : "verifications"} remaining. After
            that, you'll be able to keep verifying documents in the THIBITISHA app.
          </Alert>
        </div>
      ) : null}

      {isExhausted ? (
        <div className="upload-drop" style={{ cursor: "default" }}>
          <div className="upload-drop-icon">
            <Smartphone size={28} />
          </div>
          <h3 style={{ marginBottom: 4 }}>You've used your free web verifications</h3>
          <p className="card-subtext" style={{ marginBottom: 18, maxWidth: 380, marginLeft: "auto", marginRight: "auto" }}>
            Download the THIBITISHA app to keep verifying documents.
          </p>
          <a href={MOBILE_APK_URL} target="_blank" rel="noopener noreferrer">
            <Button>
              <Download size={15} /> Download the app
            </Button>
          </a>
        </div>
      ) : (
        <div
          className={`upload-drop${dragOver ? " drag-over" : ""}`}
          onClick={submit.isPending ? undefined : () => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFile(e.dataTransfer.files[0]);
          }}
          style={{ cursor: submit.isPending ? "default" : "pointer" }}
        >
          {submit.isPending ? (
            <div className="scanning-panel">
              <ScanningVisual />
              <div style={{ maxWidth: 300, textAlign: "left" }}>
                <h3 style={{ marginBottom: 18 }}>Analyzing your document…</h3>
                <ProgressSteps complete={false} />
              </div>
            </div>
          ) : (
            <>
              <div className="upload-drop-icon">
                <UploadCloud size={28} />
              </div>
              <h3 style={{ marginBottom: 4 }}>Drag and drop a file here, or click to choose one</h3>
              <p className="card-subtext" style={{ marginBottom: 0 }}>
                PDF, JPEG, or PNG
              </p>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            style={{ display: "none" }}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>
      )}

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <h2 style={{ marginTop: 40, marginBottom: 16 }}>Your past verifications</h2>
      {history.isLoading ? <LoadingState /> : null}
      {history.data && history.data.length === 0 ? (
        <EmptyState icon={<FileStack size={24} />} title="No verifications yet" subtext="Upload your first document above to see a forensic analysis." />
      ) : null}
      {history.data && history.data.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Assessment</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {history.data.map((v) => (
                <tr key={v.id} onClick={() => navigate(`/verify/${v.id}`)}>
                  <td>{v.originalFilename}</td>
                  <td>
                    {v.assessment ? (
                      <Badge label={ASSESSMENT_STATUS_COPY[v.assessment.status].label} tone={ASSESSMENT_STATUS_COPY[v.assessment.status].tone} />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{new Date(v.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
