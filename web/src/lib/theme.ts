export type ThemeMode = "light" | "dark";

const THEME_KEY = "document_sentinel.theme";

// Dark is the default identity regardless of OS preference — not an
// auto-detected prefers-color-scheme fallback. (Flipped from light per
// explicit direction: flat white surfaces read as unprofessional; the
// deep, richly-tinted dark surfaces are the primary look now. Light stays
// fully built and selectable via the toggle.)
export function getStoredTheme(): ThemeMode {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "light" ? "light" : "dark";
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.setAttribute("data-theme", mode);
  localStorage.setItem(THEME_KEY, mode);
}
