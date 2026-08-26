import { useState } from "react";
import { HelpCircle } from "lucide-react";

// Every status badge in the app sits next to one of these — tapping it
// reveals the plain-language "why" copy from statusCopy.ts, so a business
// user never has to guess what e.g. SUSPICIOUS actually means.
export function WhyButton({ why }: { why: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="why-btn" onClick={() => setOpen((v) => !v)}>
        <HelpCircle size={13} />
        Why?
      </button>
      {open ? <div className="why-panel fade-in">{why}</div> : null}
    </>
  );
}
