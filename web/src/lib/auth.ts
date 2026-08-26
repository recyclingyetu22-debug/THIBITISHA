// localStorage, not an httpOnly cookie: the backend is a pure bearer-token
// API with no cookie support (see backend/src/middleware/auth.ts), and this
// is an internal institutional tool, not a public-facing site — accepted
// tradeoff for a first web UI pass, not a silent choice.
const ACCESS_TOKEN_KEY = "document_sentinel.accessToken";
const REFRESH_TOKEN_KEY = "document_sentinel.refreshToken";
const USER_KEY = "document_sentinel.user";

export function saveTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export interface StoredUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
}

// Snapshot of the login/register response, used only for immediate
// client-side nav gating (which links to show). Can go stale if roles
// change server-side later in the session — acceptable here since every
// route the nav points at is independently enforced by the backend's own
// role gate regardless of what this says.
export function saveUser(user: StoredUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getUser(): StoredUser | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as StoredUser) : null;
}
