// Forensic annotation primitives — dashed boxes, magnifier callouts,
// typography brackets, signature outlines, metadata tags. Each is a bare
// <g>, positioned by the caller in the same coordinate space as the
// document it's annotating (see DocumentPaper.tsx). `tone` is either
// "brand" (routine/informative — most annotations, since most examination
// finds nothing) or "danger" (the one flagged item), reusing the same
// semantic-tone discipline as statusCopy.ts elsewhere in the app.
export type MarkerTone = "brand" | "danger";

function toneColors(tone: MarkerTone) {
  return tone === "danger"
    ? { stroke: "var(--status-danger-fg)", chipBg: "var(--status-danger-bg)", chipFg: "var(--status-danger-fg)" }
    : { stroke: "var(--brand-primary)", chipBg: "var(--surface)", chipFg: "var(--brand-primary)" };
}

interface LabelChipProps {
  x: number;
  y: number;
  text: string;
  tone: MarkerTone;
  anchor?: "start" | "middle" | "end";
}

function LabelChip({ x, y, text, tone, anchor = "start" }: LabelChipProps) {
  const c = toneColors(tone);
  const width = text.length * 5.6 + 14;
  const chipX = anchor === "end" ? x - width : anchor === "middle" ? x - width / 2 : x;
  return (
    <g>
      <rect x={chipX} y={y - 11} width={width} height={16} rx={8} fill={c.chipBg} stroke={c.stroke} strokeWidth={1} />
      <text x={chipX + width / 2} y={y} textAnchor="middle" fontSize={8} fontWeight={700} fill={c.chipFg} letterSpacing="0.02em">
        {text}
      </text>
    </g>
  );
}

export function BoundingBoxMarker({
  x,
  y,
  width,
  height,
  label,
  tone = "brand",
  pulse = false,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  tone?: MarkerTone;
  pulse?: boolean;
}) {
  const c = toneColors(tone);
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill="none" stroke={c.stroke} strokeWidth={1.5} strokeDasharray="4 3" rx={3} className={pulse ? "pulse" : undefined} />
      <LabelChip x={x} y={y - 10} text={label} tone={tone} />
    </g>
  );
}

export function SuspiciousRegionMarker(props: { x: number; y: number; width: number; height: number; label: string }) {
  return <BoundingBoxMarker {...props} tone="danger" pulse />;
}

export function SignatureMarker({ x, y, width, height, label }: { x: number; y: number; width: number; height: number; label: string }) {
  const c = toneColors("brand");
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill="none" stroke={c.stroke} strokeWidth={1.5} strokeDasharray="3 3" rx={6} />
      <LabelChip x={x + width / 2} y={y + height + 16} text={label} tone="brand" anchor="middle" />
    </g>
  );
}

export function TypographyMarker({ x, y, width, label }: { x: number; y: number; width: number; label: string }) {
  const c = toneColors("brand");
  return (
    <g>
      <path d={`M${x} ${y} L${x} ${y + 6} L${x + width} ${y + 6} L${x + width} ${y}`} stroke={c.stroke} strokeWidth={1.5} fill="none" />
      <text x={x - 14} y={y + 4} fontSize={11} fontWeight={700} fontStyle="italic" fill={c.stroke}>
        Aa
      </text>
      <LabelChip x={x + width / 2} y={y + 22} text={label} tone="brand" anchor="middle" />
    </g>
  );
}

export function MagnifierMarker({
  lensX,
  lensY,
  r = 24,
  targetX,
  targetY,
  label,
}: {
  lensX: number;
  lensY: number;
  r?: number;
  targetX: number;
  targetY: number;
  label: string;
}) {
  const c = toneColors("brand");
  // Connector from the lens edge (closest point toward the target) to the target point.
  const dx = targetX - lensX;
  const dy = targetY - lensY;
  const dist = Math.hypot(dx, dy) || 1;
  const edgeX = lensX + (dx / dist) * r;
  const edgeY = lensY + (dy / dist) * r;
  const handleX = lensX + (r * 0.75) * Math.SQRT1_2;
  const handleY = lensY + (r * 0.75) * Math.SQRT1_2;
  return (
    <g>
      <line x1={edgeX} y1={edgeY} x2={targetX} y2={targetY} stroke={c.stroke} strokeWidth={1} strokeDasharray="2 3" opacity={0.7} />
      <circle cx={lensX} cy={lensY} r={r} fill="var(--surface)" stroke={c.stroke} strokeWidth={2} />
      <circle cx={lensX} cy={lensY} r={r - 6} fill="none" stroke={c.stroke} strokeWidth={1} opacity={0.4} />
      <line x1={handleX} y1={handleY} x2={handleX + r * 0.4} y2={handleY + r * 0.4} stroke={c.stroke} strokeWidth={3} strokeLinecap="round" />
      <LabelChip x={lensX} y={lensY + r + 16} text={label} tone="brand" anchor="middle" />
    </g>
  );
}

export function MetadataTag({ x, y, label, connectTo }: { x: number; y: number; label: string; connectTo?: { x: number; y: number } }) {
  const c = toneColors("brand");
  return (
    <g>
      {connectTo ? <line x1={x} y1={y} x2={connectTo.x} y2={connectTo.y} stroke={c.stroke} strokeWidth={1} strokeDasharray="2 3" opacity={0.6} /> : null}
      <LabelChip x={x} y={y} text={label} tone="brand" anchor="middle" />
    </g>
  );
}
