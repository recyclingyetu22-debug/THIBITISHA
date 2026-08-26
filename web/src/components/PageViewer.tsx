import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getPageImageUrl } from "../lib/api/verifications.js";
import { SEVERITY_COPY } from "../lib/statusCopy.js";
import { Button } from "./Button.js";
import { LoadingState } from "./LoadingState.js";
import { Alert } from "./Alert.js";
import type { FindingSeverity, PixelRect } from "../lib/api/types.js";

// CSS custom-property references, not literal colors — these track the
// active theme (light/dark) automatically via tokens.css.
const SEVERITY_BORDER: Record<FindingSeverity, string> = {
  INFO: "var(--status-info-fg)",
  LOW: "var(--status-clear-fg)",
  MEDIUM: "var(--status-caution-fg)",
  HIGH: "var(--status-danger-fg)",
};

export interface OverlayRegion {
  key: string; // unique per rendered box (a finding can have multiple regions)
  selectKey: string; // identifies the parent finding — shared across that finding's boxes, and with the caller's own finding keys
  rect: PixelRect;
  severity: FindingSeverity;
  selected: boolean;
}

interface PageViewerProps {
  verificationId: string;
  pageNumber: number;
  pageCount: number;
  regions: OverlayRegion[];
  onSelectRegion?: (key: string) => void;
  onPageChange: (page: number) => void;
}

// Region-image auth: GET .../pages/:pageNumber/image needs a Bearer header,
// which a plain <img src> can't send, so the blob is fetched manually and
// exposed as an object URL (see fetchAuthenticatedBlobUrl in api/client.ts).
// Overlay boxes are positioned as a percentage of the rendered <img>'s own
// natural size — the backend guarantees `regions` and this image share the
// same pixel space 1:1, so no scale constant needs duplicating here.
export function PageViewer({ verificationId, pageNumber, pageCount, regions, onSelectRegion, onPageChange }: PageViewerProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let currentUrl: string | null = null;
    setNaturalSize(null);
    setError(null);

    getPageImageUrl(verificationId, pageNumber)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        currentUrl = url;
        setImageUrl(url);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this page's image.");
      });

    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [verificationId, pageNumber]);

  return (
    <div>
      {pageCount > 1 ? (
        <div className="page-nav">
          <Button variant="secondary" size="sm" disabled={pageNumber <= 1} onClick={() => onPageChange(pageNumber - 1)}>
            <ChevronLeft size={14} /> Previous
          </Button>
          <span>
            Page {pageNumber} of {pageCount}
          </span>
          <Button variant="secondary" size="sm" disabled={pageNumber >= pageCount} onClick={() => onPageChange(pageNumber + 1)}>
            Next <ChevronRight size={14} />
          </Button>
        </div>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {imageUrl ? (
        <div className="page-viewer">
          <img
            src={imageUrl}
            alt={`Page ${pageNumber}`}
            onLoad={(e) => setNaturalSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
          />
          {naturalSize
            ? regions.map((region) => (
                <div
                  key={region.key}
                  className={`region-overlay${region.selected ? " selected" : ""}`}
                  onClick={onSelectRegion ? () => onSelectRegion(region.selectKey) : undefined}
                  style={{
                    left: `${(region.rect.x / naturalSize.width) * 100}%`,
                    top: `${(region.rect.y / naturalSize.height) * 100}%`,
                    width: `${(region.rect.width / naturalSize.width) * 100}%`,
                    height: `${(region.rect.height / naturalSize.height) * 100}%`,
                    borderColor: SEVERITY_BORDER[region.severity],
                    pointerEvents: onSelectRegion ? "auto" : "none",
                    cursor: onSelectRegion ? "pointer" : undefined,
                  }}
                  title={SEVERITY_COPY[region.severity].label}
                />
              ))
            : null}
        </div>
      ) : !error ? (
        <LoadingState label="Loading page image…" />
      ) : null}
    </div>
  );
}
