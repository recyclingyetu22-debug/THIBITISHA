import { Router } from "express";
import { prisma } from "../../db/client.js";
import { requireAuth } from "../../middleware/auth.js";
import { attachTenant, type TenantScopedRequest } from "../../middleware/tenant.js";
import { HttpError } from "../../middleware/errorHandler.js";

export const organizationsRouter = Router();

organizationsRouter.use(requireAuth, attachTenant);

organizationsRouter.get("/me", async (req, res, next) => {
  try {
    const request = req as TenantScopedRequest;
    const organization = await prisma.organization.findUnique({ where: { id: request.orgId } });
    if (!organization) {
      throw new HttpError(404, "Organization not found");
    }
    res.json({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
      createdAt: organization.createdAt,
    });
  } catch (err) {
    next(err);
  }
});
