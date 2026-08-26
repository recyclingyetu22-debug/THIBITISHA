import { request } from "./client.js";
import { clearTokens, saveTokens, saveUser } from "../auth.js";
import type { Role } from "./types.js";

export interface AuthResult {
  user: { id: string; email: string; name: string; roles: Role[] };
  accessToken: string;
  refreshToken: string;
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const result = await request<AuthResult>("/auth/login", {
    method: "POST",
    body: { email, password },
    authenticated: false,
  });
  saveTokens(result.accessToken, result.refreshToken);
  saveUser(result.user);
  return result;
}

export async function registerOrganization(params: {
  organizationName: string;
  adminName: string;
  email: string;
  password: string;
}): Promise<AuthResult> {
  const result = await request<AuthResult>("/auth/register-organization", {
    method: "POST",
    body: params,
    authenticated: false,
  });
  saveTokens(result.accessToken, result.refreshToken);
  saveUser(result.user);
  return result;
}

export function logout(): void {
  clearTokens();
}
