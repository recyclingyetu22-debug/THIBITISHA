import type { ReactNode } from "react";
import type { Tone } from "../lib/statusCopy.js";

export function Alert({ tone, icon, children }: { tone: Exclude<Tone, "match">; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={`alert tone-${tone}`}>
      {icon}
      <div>{children}</div>
    </div>
  );
}
