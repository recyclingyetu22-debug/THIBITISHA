// Fully original, hand-drawn document illustrations — no stock photography,
// no real logos or government insignia, no real people. Every name,
// institution, and number below is fictional placeholder content invented
// for this illustration. Two variants: `certificate` (formal, centered —
// used for the hero/what-we-look-for scenes) and `form` (invoice-style,
// left-aligned — used for the before/after tampering example, where a
// changeable total amount tells the story more intuitively than a
// certificate would).
//
// Each variant exports both a standalone `<svg>` wrapper (DocumentPaper*)
// for simple use, and a bare `<g>` version (*Marks) sized in the same
// 0..300x0..400 (or 0..320x0..240) coordinate space — composed scenes place
// the *Marks version directly inside their own shared <svg viewBox>,
// wrapped in a positioning/rotation <g transform>, so annotation markers
// can be drawn in the same coordinate system without nested <svg> viewports.
import { useId } from "react";

export interface CertificateContent {
  recipientName?: string;
  program?: string;
  institution?: string;
  certNumber?: string;
  date?: string;
}

export interface FormContent {
  invoiceNumber?: string;
  billTo?: string;
  total?: string;
}

const RULED_LINES = [
  { width: 220, y: 240 },
  { width: 180, y: 254 },
  { width: 200, y: 268 },
];

const QR_CELLS: Array<[number, number]> = [
  [0, 1], [0, 3], [1, 1], [1, 2], [2, 0], [2, 3], [2, 4], [3, 1], [3, 4], [4, 2], [4, 3],
];

export function CertificateMarks({
  recipientName = "Amara N. Okafor",
  program = "Advanced Coastal Engineering",
  institution = "Kestrel River Institute",
  certNumber = "KRI-2025-04831",
  date = "14 March 2025",
}: CertificateContent) {
  const gradientId = useId();
  return (
    <g role="img" aria-label="Illustrative certificate document">
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--brand-primary)" />
          <stop offset="100%" stopColor="var(--brand-accent)" />
        </linearGradient>
      </defs>

      <rect x={4} y={4} width={292} height={392} rx={10} fill="var(--surface)" stroke="var(--border-strong)" strokeWidth={1.5} />
      <rect x={18} y={18} width={264} height={364} rx={4} fill="none" stroke="var(--brand-accent)" strokeWidth={1} strokeOpacity={0.5} />

      {[
        [18, 18, 1, 1],
        [282, 18, -1, 1],
        [18, 382, 1, -1],
        [282, 382, -1, -1],
      ].map(([x, y, dx, dy], i) => (
        <path key={i} d={`M${x} ${y + 14 * dy} L${x} ${y} L${x + 14 * dx} ${y}`} stroke={`url(#${gradientId})`} strokeWidth={2.5} fill="none" strokeLinecap="round" />
      ))}

      <circle cx={150} cy={55} r={16} fill={`url(#${gradientId})`} />
      <path d="M143 55 L148 60 L158 48" stroke="#fff" strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />

      <text x={150} y={95} textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontSize={14} fontWeight={700} fill="var(--text)" letterSpacing="0.05em">
        CERTIFICATE OF COMPLETION
      </text>
      <line x1={112} y1={106} x2={188} y2={106} stroke="var(--border-strong)" />

      <text x={150} y={130} textAnchor="middle" fontFamily="Georgia, serif" fontSize={10} fontStyle="italic" fill="var(--text-muted)">
        This certifies that
      </text>
      <text x={150} y={156} textAnchor="middle" fontFamily="Georgia, serif" fontSize={19} fontWeight={700} fill="var(--brand-primary)">
        {recipientName}
      </text>
      <text x={150} y={179} textAnchor="middle" fontFamily="Georgia, serif" fontSize={9.5} fill="var(--text-muted)">
        has successfully completed the requirements of
      </text>
      <text x={150} y={198} textAnchor="middle" fontFamily="Georgia, serif" fontSize={12} fontWeight={600} fill="var(--text)">
        {program}
      </text>
      <text x={150} y={213} textAnchor="middle" fontFamily="Georgia, serif" fontSize={10} fill="var(--text-muted)">
        {institution}
      </text>

      {RULED_LINES.map((l, i) => (
        <rect key={i} x={150 - l.width / 2} y={l.y} width={l.width} height={2} rx={1} fill="var(--border-strong)" opacity={0.6} />
      ))}

      <path d="M40 345 C48 328 58 356 68 334 S88 340 98 328" stroke="var(--text)" strokeWidth={1.5} fill="none" strokeLinecap="round" />
      <line x1={35} y1={352} x2={112} y2={352} stroke="var(--border-strong)" />
      <text x={73} y={364} textAnchor="middle" fontSize={7.5} fill="var(--text-faint)">
        Authorized Signatory
      </text>

      <g>
        <circle cx={228} cy={345} r={30} fill="none" stroke={`url(#${gradientId})`} strokeWidth={2} />
        <circle cx={228} cy={345} r={23} fill="none" stroke={`url(#${gradientId})`} strokeWidth={1} strokeDasharray="2 3" />
        <path d="M228 333 L232 342 L242 343 L234 350 L237 360 L228 354 L219 360 L222 350 L214 343 L224 342 Z" fill={`url(#${gradientId})`} opacity={0.85} />
        <path d="M218 368 L222 378 L216 385 Z" fill="var(--brand-accent)" opacity={0.7} />
        <path d="M238 368 L234 378 L240 385 Z" fill="var(--brand-accent)" opacity={0.7} />
      </g>

      <g opacity={0.75}>
        {Array.from({ length: 5 }).map((_, row) =>
          Array.from({ length: 5 }).map((_, col) => {
            const filled = QR_CELLS.some(([r, c]) => r === row && c === col);
            return filled ? <rect key={`${row}-${col}`} x={250 + col * 4.4} y={30 + row * 4.4} width={4} height={4} fill="var(--text)" /> : null;
          }),
        )}
        {[[250, 30], [268.2, 30], [250, 48.2]].map(([x, y], i) => (
          <rect key={i} x={x} y={y} width={4.4} height={4.4} fill="none" stroke="var(--text)" strokeWidth={0.8} />
        ))}
      </g>

      <text x={150} y={388} textAnchor="middle" fontSize={7} fill="var(--text-faint)">
        Issued {date} · No. {certNumber}
      </text>
    </g>
  );
}

export function DocumentPaperCertificate(props: CertificateContent) {
  return (
    <svg viewBox="0 0 300 400" width="300" height="400">
      <CertificateMarks {...props} />
    </svg>
  );
}

export function FormMarks({ invoiceNumber = "INV-2091", billTo = "Northbridge Trading Co.", total = "$1,240.00" }: FormContent) {
  const gradientId = useId();
  const items = [
    { label: "Consulting services — March", amount: "$820.00" },
    { label: "Document processing fee", amount: "$260.00" },
    { label: "Courier & handling", amount: "$160.00" },
  ];
  return (
    <g role="img" aria-label="Illustrative invoice document">
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--brand-primary)" />
          <stop offset="100%" stopColor="var(--brand-accent)" />
        </linearGradient>
      </defs>

      <rect x={3} y={3} width={314} height={234} rx={8} fill="var(--surface)" stroke="var(--border-strong)" strokeWidth={1.5} />

      <rect x={20} y={20} width={26} height={26} rx={7} fill={`url(#${gradientId})`} />
      <path d="M28 33 L32 37 L40 27" stroke="#fff" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <text x={54} y={32} fontSize={14} fontWeight={700} fill="var(--text)" letterSpacing="0.03em">
        INVOICE
      </text>
      <text x={54} y={44} fontSize={8.5} fill="var(--text-faint)">
        {invoiceNumber}
      </text>

      <text x={296} y={26} textAnchor="end" fontSize={7.5} fill="var(--text-faint)">
        BILL TO
      </text>
      <text x={296} y={38} textAnchor="end" fontSize={9.5} fill="var(--text)" fontWeight={600}>
        {billTo}
      </text>

      <line x1={20} y1={62} x2={300} y2={62} stroke="var(--border)" />

      {items.map((item, i) => {
        const y = 84 + i * 24;
        return (
          <g key={i}>
            <rect x={20} y={y - 8} width={150} height={5} rx={2} fill="var(--border-strong)" opacity={0.6} />
            <text x={300} y={y} textAnchor="end" fontSize={9.5} fill="var(--text-muted)">
              {item.amount}
            </text>
          </g>
        );
      })}

      <line x1={20} y1={168} x2={300} y2={168} stroke="var(--border)" />
      <text x={220} y={192} fontSize={10} fontWeight={700} fill="var(--text)">
        TOTAL
      </text>
      <text x={300} y={192} textAnchor="end" fontSize={15} fontWeight={800} fill="var(--brand-primary)">
        {total}
      </text>

      <text x={20} y={220} fontSize={7} fill="var(--text-faint)">
        Payment due within 30 days
      </text>
    </g>
  );
}

export function DocumentPaperForm(props: FormContent) {
  return (
    <svg viewBox="0 0 320 240" width="320" height="240">
      <FormMarks {...props} />
    </svg>
  );
}
