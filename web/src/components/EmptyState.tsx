import type { ReactNode } from "react";

export function EmptyState({ icon, title, subtext }: { icon: ReactNode; title: string; subtext?: string }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <h3>{title}</h3>
      {subtext ? <p className="card-subtext" style={{ margin: "0 auto", maxWidth: 380 }}>{subtext}</p> : null}
    </div>
  );
}
