import { Router } from "express";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { attachTenant, type TenantScopedRequest } from "../../middleware/tenant.js";
import { HttpError } from "../../middleware/errorHandler.js";
import { recordAuditEvent } from "../audit/auditLog.js";
import { createUserSchema } from "./users.schemas.js";

export const usersRouter = Router();

usersRouter.use(requireAuth, attachTenant);

usersRouter.get("/", requireRole(Role.ORG_ADMIN, Role.SUPER_ADMIN), async (req, res, next) => {
  try {
    const request = req as TenantScopedRequest;
    const users = await prisma.user.findMany({
      where: { organizationId: request.orgId },
      include: { roles: true },
      orderBy: { createdAt: "asc" },
    });
    res.json(
      users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        status: u.status,
        roles: u.roles.map((r) => r.role),
        createdAt: u.createdAt,
      })),
    );
  } catch (err) {
    next(err);
  }
});

usersRouter.post("/", requireRole(Role.ORG_ADMIN, Role.SUPER_ADMIN), async (req, res, next) => {
  try {
    const request = req as TenantScopedRequest;
    const body = createUserSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      throw new HttpError(409, "Email already registered");
    }

    const passwordHash = await bcrypt.hash(body.password, 12);

    const user = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          organizationId: request.orgId,
          email: body.email,
          name: body.name,
          passwordHash,
          roles: { create: body.roles.map((role) => ({ role })) },
        },
        include: { roles: true },
      });

      await recordAuditEvent(tx, {
        organizationId: request.orgId,
        userId: request.auth!.sub,
        action: "user_created",
        entityType: "User",
        entityId: user.id,
        metadata: { roles: body.roles },
      });

      return user;
    });

    res.status(201).json({
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles.map((r) => r.role),
    });
  } catch (err) {
    next(err);
  }
});
