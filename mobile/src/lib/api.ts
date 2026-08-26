import * as FileSystem from "expo-file-system";
import { API_BASE_URL } from "./config";
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from "./auth";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;

  const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return null;

  const body = (await res.json()) as { accessToken: string };
  await saveTokens(body.accessToken, refreshToken);
  return body.accessToken;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  isMultipart?: boolean;
  authenticated?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}, isRetry = false): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;

  if (options.isMultipart) {
    body = options.body as FormData;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  if (options.authenticated !== false) {
    const token = await getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, { method: options.method ?? "GET", headers, body });

  if (res.status === 401 && options.authenticated !== false && !isRetry) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return request<T>(path, options, true);
    }
    await clearTokens();
  }

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, errorBody.error ?? "Request failed");
  }

  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface AuthResult {
  user: { id: string; email: string; name: string; roles: string[] };
  accessToken: string;
  refreshToken: string;
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const result = await request<AuthResult>("/auth/login", {
    method: "POST",
    body: { email, password },
    authenticated: false,
  });
  await saveTokens(result.accessToken, result.refreshToken);
  return result;
}

export async function logout(): Promise<void> {
  await clearTokens();
}

export interface DocumentSummary {
  id: string;
  documentNumber: string;
  documentType: string;
  title: string;
  classification: string;
  status: string;
  currentVersion: { versionNumber: number; sha256: string } | null;
  createdAt: string;
}

export interface DocumentDetail extends DocumentSummary {
  issuer: string | null;
  ownerName: string | null;
  currentVersion:
    | { versionNumber: number; sha256: string; mimeType: string; sizeBytes: number; createdAt: string }
    | null;
  versionCount: number;
}

export function listDocuments(): Promise<DocumentSummary[]> {
  return request<DocumentSummary[]>("/documents");
}

export function getDocument(id: string): Promise<DocumentDetail> {
  return request<DocumentDetail>(`/documents/${id}`);
}

// Basic viewer's download action: pulls the org-scoped original into the
// app's cache dir so it can be handed to the OS share sheet. Not a preview —
// Phase 1 has no rendering, just "get the original bytes back out".
export async function downloadDocumentFile(id: string, suggestedName: string): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new ApiError(401, "Not authenticated");

  const destination = `${FileSystem.cacheDirectory}${suggestedName}`;
  const result = await FileSystem.downloadAsync(`${API_BASE_URL}/documents/${id}/download`, destination, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (result.status !== 200) {
    throw new ApiError(result.status, "Download failed");
  }
  return result.uri;
}
