import { Link } from "react-router-dom";
import {
  Building2,
  Download,
  FileText,
  Gavel,
  Globe,
  Lock,
  ScanSearch,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UploadCloud,
  Users,
} from "lucide-react";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { HeroForensicVisual } from "../illustrations/HeroForensicVisual.js";
import { WhatWeLookForVisual } from "../illustrations/WhatWeLookForVisual.js";
import { BeforeAfterVisual } from "../illustrations/BeforeAfterVisual.js";
import { MOBILE_APK_URL } from "../lib/constants.js";

const FOUR_CONCEPTS = [
  { icon: ShieldCheck, kind: "automated", title: "Forensic Assessment", body: "Our detectors examine the document itself and report what they find — never a claim of authenticity, just evidence." },
  { icon: FileText, kind: "comparison", title: "Reference Comparison", body: "When your organization supplies a known original, we compare directly against it." },
  { icon: Building2, kind: "manual, third-party", title: "Issuer Confirmation", body: "An investigator can contact the claimed issuing organization directly and record their response." },
  { icon: Gavel, kind: "human judgment", title: "Reviewer Decision", body: "A human investigator weighs everything above and makes the final call — never the algorithm alone." },
];

const USE_CASES = [
  { icon: Building2, title: "Organizations & businesses", body: "Banks, universities, legal teams, and government offices use THIBITISHA's investigator workspace to review documents as a team, with a full audit trail." },
  { icon: Users, title: "Individuals", body: "Anyone can upload a single document and get a clear, honest forensic read — no account setup required to see how it works." },
];

const PLATFORMS = [
  {
    icon: Globe,
    title: "Web",
    body: "Explains what THIBITISHA does and lets you try it — 2 free verifications, right in your browser, no install needed.",
    status: null,
  },
  {
    icon: Smartphone,
    title: "Mobile app",
    body: "The full THIBITISHA experience: unlimited access to the same forensic examination, once you've used your free web verifications.",
    status: null,
  },
  { icon: Sparkles, title: "Enterprise & API", body: "Volume verification and integrations for platforms and institutions.", status: "Coming soon" },
];

export function HomeScreen() {
  return (
    <div className="marketing-page">
      <div className="marketing-header">
        <span className="brand-mark">
          <span className="brand-logo">
            <ShieldCheck size={17} />
          </span>
          <span className="brand-wordmark">THIBITISHA</span>
        </span>
        <Link to="/login">
          <Button size="sm">Sign in</Button>
        </Link>
      </div>

      <section className="hero-section">
        <div className="hero-copy">
          <span className="eyebrow">
            <ScanSearch size={13} /> Document verification &amp; forensics
          </span>
          <h1 className="hero-headline">Verify before you trust.</h1>
          <p className="hero-subhead">
            Upload a document. THIBITISHA examines it. Evidence appears — in plain language, backed by full
            forensic detail for the investigators who need it.
          </p>
          <div className="hero-steps">
            <span><UploadCloud size={15} /> Upload</span>
            <span>→</span>
            <span><ScanSearch size={15} /> Examine</span>
            <span>→</span>
            <span><ShieldCheck size={15} /> Evidence</span>
          </div>
          <Link to="/login">
            <Button>Try THIBITISHA</Button>
          </Link>
        </div>
        <div className="hero-visual">
          <HeroForensicVisual />
        </div>
      </section>

      <section className="marketing-section">
        <div className="section-heading">
          <h2>See what THIBITISHA looks for.</h2>
          <p className="card-subtext">Five categories of forensic examination, explained in plain language — the same language you'll see in every result.</p>
        </div>
        <WhatWeLookForVisual />
      </section>

      <section className="marketing-section">
        <div className="section-heading">
          <h2>Honest by design</h2>
          <p className="card-subtext">A before-and-after look at how THIBITISHA surfaces evidence, without overclaiming.</p>
        </div>
        <BeforeAfterVisual />
      </section>

      <section className="marketing-section">
        <div className="section-heading">
          <h2>Four kinds of evidence, never conflated</h2>
          <p className="card-subtext">Every verification keeps these separate — structurally, and on screen.</p>
        </div>
        <div className="card-grid">
          {FOUR_CONCEPTS.map((c) => (
            <Card key={c.title} title={c.title} kind={c.kind} icon={<c.icon size={16} />}>
              <p className="card-subtext" style={{ marginBottom: 0 }}>{c.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="marketing-section">
        <div className="card-grid">
          <Card title="Security &amp; privacy" icon={<Lock size={16} />}>
            <p className="card-subtext" style={{ marginBottom: 0 }}>
              Every organization's documents and findings are isolated from every other organization's. Access is
              role-based, and every action — from submission to a final reviewer decision — is recorded in an
              audit trail.
            </p>
          </Card>
        </div>
      </section>

      <section className="marketing-section">
        <div className="section-heading">
          <h2>Who it's for</h2>
        </div>
        <div className="card-grid">
          {USE_CASES.map((u) => (
            <Card key={u.title} title={u.title} icon={<u.icon size={16} />}>
              <p className="card-subtext" style={{ marginBottom: 0 }}>{u.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="marketing-section">
        <div className="section-heading">
          <h2>Web, mobile, and beyond</h2>
        </div>
        <div className="card-grid">
          {PLATFORMS.map((p) => (
            <Card key={p.title} title={p.title} icon={<p.icon size={16} />}>
              <p className="card-subtext" style={{ marginBottom: 10 }}>{p.body}</p>
              {p.status ? <span className="badge tone-info">{p.status}</span> : null}
              {p.title === "Mobile app" ? (
                <div style={{ marginTop: 12 }}>
                  <a href={MOBILE_APK_URL} target="_blank" rel="noopener noreferrer">
                    <Button variant="secondary" size="sm">
                      <Download size={13} /> Download for Android
                    </Button>
                  </a>
                  <p className="card-subtext" style={{ marginTop: 8, marginBottom: 0 }}>
                    Android only, unsigned test build — Android will warn about an unknown source; that's expected
                    for a build outside the Play Store.
                  </p>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      </section>

      <footer className="marketing-footer">
        <div>
          <span className="brand-wordmark">THIBITISHA</span>
          <p className="card-subtext" style={{ marginBottom: 0 }}>Verify before you trust.</p>
        </div>
        <Link to="/login">
          <Button variant="secondary">Sign in</Button>
        </Link>
      </footer>
    </div>
  );
}
