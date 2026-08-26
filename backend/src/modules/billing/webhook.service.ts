import { prisma } from "../../db/client.js";
import { HttpError } from "../../middleware/errorHandler.js";
import { grantEntitlement } from "./ledger.js";
import { getPaymentProvider } from "./paymentProvider.js";

export interface WebhookPayload {
  providerTransactionId: string;
  status: "PAID" | "FAILED";
  amount: number;
  currency: string;
}

// Idempotency here is a guarded UPDATE, not an insert-uniqueness check —
// the PaymentTransaction row already exists (created PENDING at checkout
// time in payment.service.ts); the webhook's job is to transition it to
// PAID exactly once. `updateMany` with `status: "PENDING"` in the WHERE
// clause is the same atomic-guard pattern as entitlement consumption
// (ledger.ts) — a replayed webhook finds the row already PAID, the guard
// matches zero rows, and nothing is granted twice. The @@unique constraint
// on (provider, providerTransactionId) is defense in depth on top of this.
export async function handleWebhook(rawBody: string, signature: string | undefined, payload: WebhookPayload) {
  const provider = getPaymentProvider();
  if (!provider.verifyWebhookSignature(rawBody, signature)) {
    throw new HttpError(401, "Invalid webhook signature");
  }

  const transaction = await prisma.paymentTransaction.findUnique({
    where: { provider_providerTransactionId: { provider: provider.name, providerTransactionId: payload.providerTransactionId } },
  });
  if (!transaction) {
    throw new HttpError(404, "Unknown transaction");
  }
  if (transaction.amount !== payload.amount || transaction.currency !== payload.currency) {
    throw new HttpError(422, "Amount/currency mismatch");
  }

  if (payload.status === "FAILED") {
    await prisma.paymentTransaction.updateMany({ where: { id: transaction.id, status: "PENDING" }, data: { status: "FAILED" } });
    return { granted: false };
  }

  return prisma.$transaction(async (tx) => {
    const result = await tx.paymentTransaction.updateMany({ where: { id: transaction.id, status: "PENDING" }, data: { status: "PAID" } });
    if (result.count === 0) {
      // Already processed (duplicate webhook) — no-op, not an error.
      return { granted: false };
    }

    if (!transaction.planId) {
      throw new HttpError(422, "Payment transaction has no associated plan");
    }
    const plan = await tx.plan.findUniqueOrThrow({ where: { id: transaction.planId } });
    if (plan.allowancePerPeriod === null) {
      throw new HttpError(422, "Plan has no configured allowance");
    }

    await grantEntitlement(tx, transaction.accountId, "PURCHASE", plan.allowancePerPeriod, "PaymentTransaction", transaction.id);
    return { granted: true, amount: plan.allowancePerPeriod };
  });
}
