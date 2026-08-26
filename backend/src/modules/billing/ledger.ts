import type { EntitlementTransactionType, Prisma, PrismaClient } from "@prisma/client";

type TransactionClient = Prisma.TransactionClient | PrismaClient;

export class InsufficientEntitlementError extends Error {
  constructor() {
    super("No verifications remaining. Purchase more to continue.");
  }
}

export interface LedgerEntryView {
  id: string;
  type: EntitlementTransactionType;
  amount: number;
  balanceAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: Date;
}

// The one place that touches EntitlementAccount.balance. Every write here
// is the same shape: atomically adjust the cached balance, then insert the
// permanent, append-only ledger row recording exactly what happened and
// what the balance became. Never called with amount 0.
async function writeLedgerEntry(
  tx: TransactionClient,
  accountId: string,
  type: EntitlementTransactionType,
  amount: number,
  referenceType?: string,
  referenceId?: string,
  metadata?: Prisma.InputJsonValue,
): Promise<LedgerEntryView> {
  const account = await tx.entitlementAccount.update({
    where: { id: accountId },
    data: { balance: { increment: amount } },
  });

  return tx.entitlementTransaction.create({
    data: {
      accountId,
      type,
      amount,
      balanceAfter: account.balance,
      referenceType: referenceType ?? null,
      referenceId: referenceId ?? null,
      metadata: metadata ?? undefined,
    },
  });
}

// Grants are unconditional (free grant, purchase, subscription, promo,
// admin adjustment) — no guard needed, amount is always positive.
export async function grantEntitlement(
  tx: TransactionClient,
  accountId: string,
  type: Exclude<EntitlementTransactionType, "VERIFICATION_CONSUMPTION">,
  amount: number,
  referenceType?: string,
  referenceId?: string,
  metadata?: Prisma.InputJsonValue,
): Promise<LedgerEntryView> {
  return writeLedgerEntry(tx, accountId, type, amount, referenceType, referenceId, metadata);
}

// Concurrency-safe consumption: an atomic guarded decrement (a single
// UPDATE statement with a WHERE balance >= 1 guard, evaluated under
// Postgres's row lock) — the same class of solution already proven in this
// codebase for the global document-number counter (see
// documentNumberConcurrency.test.ts). If the guard fails (count === 0),
// nothing is written — no partial ledger entry, no negative balance ever
// possible. Throws InsufficientEntitlementError rather than returning null
// so callers can't accidentally ignore an insufficient-balance result.
export async function consumeEntitlement(
  tx: TransactionClient,
  accountId: string,
  referenceType: string,
  referenceId: string,
): Promise<LedgerEntryView> {
  const result = await tx.entitlementAccount.updateMany({
    where: { id: accountId, balance: { gte: 1 } },
    data: { balance: { decrement: 1 } },
  });
  if (result.count === 0) {
    throw new InsufficientEntitlementError();
  }

  // Postgres transactions read their own writes, so this reliably reflects
  // the decrement that just happened above, even under concurrent load —
  // no other transaction can observe or modify this row until we commit.
  const { balance } = await tx.entitlementAccount.findUniqueOrThrow({ where: { id: accountId }, select: { balance: true } });

  return tx.entitlementTransaction.create({
    data: {
      accountId,
      type: "VERIFICATION_CONSUMPTION",
      amount: -1,
      balanceAfter: balance,
      referenceType,
      referenceId,
    },
  });
}

// The compensating write when analysis fails after consumption already
// happened — a new +1 row, never an edit to the original consumption row.
export async function refundEntitlement(tx: TransactionClient, accountId: string, referenceType: string, referenceId: string): Promise<LedgerEntryView> {
  return writeLedgerEntry(tx, accountId, "VERIFICATION_REFUND", 1, referenceType, referenceId);
}
