import { useState } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScanSearch, ShieldCheck, LogOut } from "lucide-react";
import { getAccessToken, getUser } from "./lib/auth.js";
import { logout } from "./lib/api/auth.js";
import { Button } from "./components/Button.js";
import { ThemeToggle } from "./components/ThemeToggle.js";
import { GeometricAccent } from "./components/GeometricAccent.js";
import { HomeScreen } from "./screens/HomeScreen.js";
import { LoginScreen } from "./screens/LoginScreen.js";
import { VerifyHomeScreen } from "./screens/VerifyHomeScreen.js";
import { VerifyResultScreen } from "./screens/VerifyResultScreen.js";
import { QueueScreen } from "./screens/QueueScreen.js";
import { InvestigationScreen } from "./screens/InvestigationScreen.js";

const queryClient = new QueryClient();

function canReachInvestigatorWorkspace(): boolean {
  const roles = getUser()?.roles ?? [];
  return roles.includes("ORG_ADMIN") || roles.includes("INVESTIGATOR");
}

function TopNav({ onLogout }: { onLogout: () => void }) {
  const user = getUser();
  const showWorkspaceLink = canReachInvestigatorWorkspace();
  return (
    <div className="top-nav">
      <NavLink to="/verify" className="brand-mark">
        <span className="brand-logo">
          <ShieldCheck size={17} />
        </span>
        <span className="brand-wordmark">THIBITISHA</span>
      </NavLink>
      <nav>
        <NavLink to="/verify" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
          <ScanSearch size={15} />
          Verify a document
        </NavLink>
        {showWorkspaceLink ? (
          <NavLink to="/queue" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            <ShieldCheck size={15} />
            Investigator workspace
          </NavLink>
        ) : null}
      </nav>
      <div className="user">
        <ThemeToggle />
        {user ? <span>{user.name}</span> : null}
        <Button variant="ghost" size="sm" onClick={onLogout}>
          <LogOut size={14} /> Sign out
        </Button>
      </div>
    </div>
  );
}

function AuthenticatedApp({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="app-shell">
      <TopNav onLogout={onLogout} />
      <div className="main-content">
        <Routes>
          <Route path="/" element={<Navigate to="/verify" replace />} />
          <Route path="/login" element={<Navigate to="/verify" replace />} />
          <Route path="/verify" element={<VerifyHomeScreen />} />
          <Route path="/verify/:id" element={<VerifyResultScreen />} />
          <Route path="/queue" element={<QueueScreen />} />
          <Route path="/investigation/:id" element={<InvestigationScreen />} />
          <Route path="*" element={<Navigate to="/verify" replace />} />
        </Routes>
      </div>
    </div>
  );
}

function UnauthenticatedApp({ onAuthenticated }: { onAuthenticated: () => void }) {
  return (
    <Routes>
      <Route path="/" element={<HomeScreen />} />
      <Route path="/login" element={<LoginScreen onAuthenticated={onAuthenticated} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AppInner() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(getAccessToken()));
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    setIsAuthenticated(false);
    navigate("/login");
  }

  return (
    <>
      <GeometricAccent />
      {isAuthenticated ? (
        <AuthenticatedApp onLogout={handleLogout} />
      ) : (
        <UnauthenticatedApp onAuthenticated={() => setIsAuthenticated(true)} />
      )}
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppInner />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
