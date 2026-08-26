import { prisma } from "../../db/client.js";
import { HttpError } from "../../middleware/errorHandler.js";
import { getPaymentProvider } from "./paymentProvider.js";

// Creates (or reuses) this organization's EntitlementAccount, then asks the
// payment provider to start a checkout and records it as a PENDING
// PaymentTransaction. Nothing is granted yet — entitlement is only granted
// once a webhook confirms payment (see webhook.service.ts). Never trust a
// frontend "payment=success" — that discipline is enforced structurally
// here: this function has no code path that grants entitlement itself.
export async function createCheckout(organizationId: string, planId: string) {
  const plan = await prisma.plan.findFirst({ where: { id: planId, active: true }, include: { pricing: { where: { active: true } } } });
  if (!plan) {
    throw new HttpError(404, "Plan not found");
  }
  const pricing = plan.pricing.find((p) => p.country === null) ?? plan.pricing[0];
  if (!pricing) {
    throw new HttpError(422, "This plan has no active pricing configured");
  }

  const account = await prisma.entitlementAccount.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {},
  });

  const provider = getPaymentProvider();
  const checkout = await provider.createCheckout({ planId: plan.id, amount: pricing.amount, currency: pricing.currency });

  const paymentTransaction = await prisma.paymentTransaction.create({
    data: {
      accountId: account.id,
      provider: checkout.provider,
      providerTransactionId: checkout.providerTransactionId,
      type: plan.billingInterval ? "SUBSCRIPTION_CHARGE" : "PACKAGE_PURCHASE",
      status: "PENDING",
      amount: pricing.amount,
      currency: pricing.currency,
      planId: plan.id,
    },
  });

  return {
    checkoutId: checkout.checkoutId,
    providerTransactionId: paymentTransaction.providerTransactionId,
    provider: checkout.provider,
    amount: pricing.amount,
    currency: pricing.currency,
    planName: plan.name,
  };
}
