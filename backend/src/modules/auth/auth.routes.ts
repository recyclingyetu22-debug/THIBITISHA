import { Router } from "express";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { HttpError } from "../../middleware/errorHandler.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../middleware/auth.js";
import { recordAuditEvent } from "../audit/auditLog.js";
import { slugify } from "../../lib/slug.js";
import { provisionAccountForNewOrganization } from "../billing/entitlements.js";
import { loginSchema, refreshSchema, registerOrganizationSchema } from "./auth.schemas.js";

export const authRouter = Router();

const BCRYPT_ROUNDS = 12;

authRouter.post("/register-organization", async (req, res, next) => {
  try {
    const body = registerOrganizationSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      throw new HttpError(409, "Email already registered");
    }

    const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);

    const { organization, user } = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: body.organizationName, slug: slugify(body.organizationName) },
      });

      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: body.email,
          passwordHash,
          name: body.adminName,
          roles: { create: [{ role: Role.ORG_ADMIN }] },
        },
        include: { roles: true },
      });

      await recordAuditEvent(tx, {
        organizationId: organization.id,
        userId: user.id,
        action: "organization_registered",
        entityType: "Organization",
        entityId: organization.id,
      });

      // No-op if the free-grant plan hasn't been seeded — new org gets no
      // EntitlementAccount, same fail-open "unlimited" state as today.
      await provisionAccountForNewOrganization(tx, organization.id);

      return { organization, user };
    });

    const roles = user.roles.map((r) => r.role);
    const accessToken = signAccessToken({ sub: user.id, organizationId: organization.id, roles });
    const refreshToken = signRefreshToken({ sub: user.id });

    res.status(201).json({
      organization: { id: organization.id, name: organization.name, slug: organization.slug },
      user: { id: user.id, email: user.email, name: user.name, roles },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email: body.email },
      include: { roles: true },
    });

    // Constant-shape response for unknown email vs wrong password — don't
    // leak which one was wrong.
    const passwordHash = user?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidin";
    const valid = await bcrypt.compare(body.password, passwordHash);

    if (!user || !valid || user.status !== "ACTIVE") {
      throw new HttpError(401, "Invalid email or password");
    }

    const roles = user.roles.map((r) => r.role);
    const accessToken = signAccessToken({ sub: user.id, organizationId: user.organizationId, roles });
    const refreshToken = signRefreshToken({ sub: user.id });

    await recordAuditEvent(prisma, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "user_logged_in",
      entityType: "User",
      entityId: user.id,
    });

    res.json({
      user: { id: user.id, email: user.email, name: user.name, roles },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const body = refreshSchema.parse(req.body);

    let decoded: { sub: string };
    try {
      decoded = verifyRefreshToken(body.refreshToken);
    } catch {
      throw new HttpError(401, "Invalid or expired refresh token");
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.sub }, include: { roles: true } });
    if (!user || user.status !== "ACTIVE") {
      throw new HttpError(401, "Invalid or expired refresh token");
    }

    const roles = user.roles.map((r) => r.role);
    const accessToken = signAccessToken({ sub: user.id, organizationId: user.organizationId, roles });

    res.json({ accessToken });
  } catch (err) {
    next(err);
  }
});
