import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { login, registerOrganization } from "../lib/api/auth.js";
import { ApiError } from "../lib/api/client.js";
import { Button } from "../components/Button.js";
import { Alert } from "../components/Alert.js";

export function LoginScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await registerOrganization({ organizationName, adminName, email, password });
      }
      onAuthenticated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="center-screen">
      <div style={{ width: 400 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 28 }}>
          <span className="brand-logo" style={{ width: 52, height: 52, borderRadius: 16, marginBottom: 14 }}>
            <ShieldCheck size={26} />
          </span>
          <h1 style={{ marginBottom: 2 }}>THIBITISHA</h1>
          <p className="card-subtext" style={{ margin: 0 }}>Document Verification &amp; Forensics — Verify before you trust.</p>
        </div>

        <div className="card card-elevated">
          <div className="card-heading">
            <h2>{mode === "login" ? "Sign in" : "Register your organization"}</h2>
          </div>

          <form onSubmit={handleSubmit}>
            {mode === "register" ? (
              <>
                <div className="field">
                  <label htmlFor="organizationName">Organization name</label>
                  <input id="organizationName" value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} required />
                </div>
                <div className="field">
                  <label htmlFor="adminName">Your name</label>
                  <input id="adminName" value={adminName} onChange={(e) => setAdminName(e.target.value)} required />
                </div>
              </>
            ) : null}

            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>

            {error ? <Alert tone="danger">{error}</Alert> : null}

            <Button type="submit" disabled={submitting} style={{ width: "100%" }}>
              {submitting ? "Please wait…" : mode === "login" ? "Sign in" : "Create organization"}
            </Button>
          </form>

          <p className="card-subtext" style={{ marginTop: 18, marginBottom: 0, textAlign: "center" }}>
            {mode === "login" ? (
              <>
                New organization?{" "}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setMode("register");
                    setError(null);
                  }}
                >
                  Register here
                </a>
              </>
            ) : (
              <>
                Already registered?{" "}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setMode("login");
                    setError(null);
                  }}
                >
                  Sign in
                </a>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
