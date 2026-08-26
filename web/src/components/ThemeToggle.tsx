import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyTheme, getStoredTheme, type ThemeMode } from "../lib/theme.js";

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(() => getStoredTheme());

  function toggle() {
    const next: ThemeMode = mode === "light" ? "dark" : "light";
    applyTheme(next);
    setMode(next);
  }

  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      aria-label={mode === "light" ? "Switch to dark theme" : "Switch to light theme"}
      title={mode === "light" ? "Switch to dark theme" : "Switch to light theme"}
    >
      {mode === "light" ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}
