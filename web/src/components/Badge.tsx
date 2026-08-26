import type { ReactNode } from "react";
import type { Tone } from "../lib/statusCopy.js";

export function Badge({ label, tone, icon }: { label: string; tone: Tone; icon?: ReactNode }) {
  return (
    <span className={`badge tone-${tone}`}>
      {icon}
      {label}
    </span>
  );
}
