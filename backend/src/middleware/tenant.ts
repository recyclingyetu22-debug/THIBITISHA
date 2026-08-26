import type { NextFunction, Response } from "express";
import type { AuthedRequest } from "./auth.js";

export interface TenantScopedRequest extends AuthedRequest {
  orgId: string;
}

// Single point where "which organization am I allowed to touch" is decided:
// always the org embedded in the verified JWT, never a client-supplied
// header/body/query field. Every module that reads or writes org-scoped data
// must run this after requireAuth and use req.orgId in its Prisma `where`
// clauses (spec §4 — never allow cross-organization access).
export function attachTenant(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  (req as TenantScopedRequest).orgId = req.auth.organizationId;
  next();
}
