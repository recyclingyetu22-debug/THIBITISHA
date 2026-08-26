import { Router, type Request } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { attachTenant, type TenantScopedRequest } from "../../middleware/tenant.js";
import { HttpError } from "../../middleware/errorHandler.js";
import { prisma } from "../../db/client.js";
import { listActivePlans } from "./plans.js";
import { createCheckout } from "./payment.service.js";
import { handleWebhook } from "./webhook.service.js";

export const billingRouter = Router();

billingRouter.get("/plans", requireAuth, async (_req, res, next) => {
  try {
    const plans = await listActivePlans();
    res.json(
      plans.map((p) => ({
        id: p.id,
        key: p.key,
        name: p.name,
        description: p.description,
        category: p.category,
        billingInterval: p.billingInterval,
        allowancePerPeriod: p.allowancePerPeriod,
        pricing: p.pricing.map((pr) => ({ currency: pr.currency, amount: pr.amount, country: pr.country })),
      })),
    );
  } catch (err) {
    next(err);
  }
});

billingRouter.get("/account", requireAuth, attachTenant, async (req, res, next) => {
  try {
    const request = req as unknown as TenantScopedRequest;
    const account = await prisma.entitlementAccount.findUnique({ where: { organizationId: request.orgId } });
    if (!account) {
      res.json({ hasAccount: false, unlimited: true, balance: null });
      return;
    }
    res.json({ hasAccount: true, unlimited: false, balance: account.balance, updatedAt: account.updatedAt });
  } catch (err) {
    next(err);
  }
});

billingRouter.get("/transactions", requireAuth, attachTenant, async (req, res, next) => {
  try {
    const request = req as unknown as TenantScopedRequest;
    const account = await prisma.entitlementAccount.findUnique({ where: { organizationId: request.orgId } });
    if (!account) {
      res.json([]);
      return;
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const transactions = await prisma.entitlementTransaction.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    res.json(transactions);
  } catch (err) {
    next(err);
  }
});

billingRouter.get("/usage", requireAuth, attachTenant, async (req, res, next) => {
  try {
    const request = req as unknown as TenantScopedRequest;
    const [usageCount, account] = await Promise.all([
      prisma.usageRecord.count({ where: { organizationId: request.orgId } }),
      prisma.entitlementAccount.findUnique({ where: { organizationId: request.orgId } }),
    ]);
    res.json({
      totalVerifications: usageCount,
      currentBalance: account?.balance ?? null,
      unlimited: !account,
    });
  } catch (err) {
    next(err);
  }
});

const checkoutSchema = z.object({ planId: z.string().uuid() });

billingRouter.post("/checkout", requireAuth, attachTenant, async (req, res, next) => {
  try {
    const request = req as unknown as TenantScopedRequest;
    const body = checkoutSchema.parse(req.body);
    const checkout = await createCheckout(request.orgId, body.planId);
    res.status(201).json(checkout);
  } catch (err) {
    next(err);
  }
});

billingRouter.get("/subscription", requireAuth, attachTenant, async (req, res, next) => {
  try {
    const request = req as unknown as TenantScopedRequest;
    const account = await prisma.entitlementAccount.findUnique({ where: { organizationId: request.orgId } });
    if (!account) {
      res.json(null);
      return;
    }
    const subscription = await prisma.subscription.findFirst({
      where: { accountId: account.id, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      include: { plan: true },
    });
    res.json(subscription);
  } catch (err) {
    next(err);
  }
});

billingRouter.post("/subscription/cancel", requireAuth, attachTenant, async (req, res, next) => {
  try {
    const request = req as unknown as TenantScopedRequest;
    const account = await prisma.entitlementAccount.findUnique({ where: { organizationId: request.orgId } });
    if (!account) {
      throw new HttpError(404, "No billing account found");
    }
    // No automatic renewal/expiration job exists in this codebase (would
    // need a scheduler) — cancelling just stops future renewal from this
    // point; it does not immediately revoke the current period's allowance.
    const result = await prisma.subscription.updateMany({
      where: { accountId: account.id, status: "ACTIVE" },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    if (result.count === 0) {
      throw new HttpError(404, "No active subscription to cancel");
    }
    res.json({ cancelled: true });
  } catch (err) {
    next(err);
  }
});

const webhookPayloadSchema = z.object({
  providerTransactionId: z.string(),
  status: z.enum(["PAID", "FAILED"]),
  amount: z.number().int(),
  currency: z.string(),
});

// Not tenant-scoped, not requireAuth-gated — this is called by the payment
// provider itself, not a logged-in user. Trust comes entirely from the
// signature check inside handleWebhook, verified against the raw request
// body (see app.ts's express.json({ verify }) hook for why rawBody exists).
billingRouter.post("/webhooks/:provider", async (req, res, next) => {
  try {
    const rawBody = (req as Request & { rawBody?: string }).rawBody ?? "";
    const signature = req.header("x-webhook-signature");
    const payload = webhookPayloadSchema.parse(req.body);
    const result = await handleWebhook(rawBody, signature, payload);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
