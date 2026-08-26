import { useEffect, useState } from "react";
import { Check } from "lucide-react";

const STEPS = [
  "Document received",
  "Checking file integrity",
  "Analyzing document structure",
  "Examining text",
  "Examining images",
  "Checking typography",
  "Analyzing suspicious regions",
  "Checking AI indicators",
  "Preparing evidence",
];

const STEP_INTERVAL_MS = 650;

// Submission is a single synchronous API call (no polling — an earlier,
// deliberate architecture decision), so these steps are a paced,
// presentational sequence during the wait, not literal real-time backend
// phase events. They advance on a timer and stop at the last step until
// `complete` arrives; if the real response lands early, everything jumps
// to done immediately rather than padding the wait to look busier.
export function ProgressSteps({ complete }: { complete: boolean }) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (complete) return;
    const timer = setInterval(() => {
      setActiveIndex((i) => Math.min(i + 1, STEPS.length - 1));
    }, STEP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [complete]);

  return (
    <div className="progress-steps">
      {STEPS.map((step, i) => {
        const isDone = complete || i < activeIndex;
        const isActive = !complete && i === activeIndex;
        return (
          <div key={step} className={`progress-step${isDone ? " done" : ""}${isActive ? " active" : ""}`}>
            <span className="progress-step-icon">{isDone ? <Check size={12} /> : isActive ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> : null}</span>
            {step}
          </div>
        );
      })}
    </div>
  );
}
