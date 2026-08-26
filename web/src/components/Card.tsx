import type { ReactNode } from "react";

// `kind` names what category of concept this card represents (e.g.
// "AUTOMATED", "MANUAL, THIRD-PARTY", "HUMAN JUDGMENT") — every card that
// shows one of the four verification-lifecycle concepts must set it, so the
// distinction stays visible in the UI, not just structurally present in the
// API response.
export function Card({
  title,
  kind,
  subtext,
  icon,
  elevated,
  children,
}: {
  title: string;
  kind?: string;
  subtext?: string;
  icon?: ReactNode;
  elevated?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`card fade-in${elevated ? " card-elevated" : ""}`}>
      <div className="card-heading">
        <h2>
          {icon}
          {title}
        </h2>
        {kind ? <span className="kind">{kind}</span> : null}
      </div>
      {subtext ? <p className="card-subtext">{subtext}</p> : null}
      {children}
    </div>
  );
}
