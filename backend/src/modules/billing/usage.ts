import type { ClientPlatform, Prisma, PrismaClient } from "@prisma/client";

// The calendar-month bucket a usage record falls into — a pure function so
// it's directly unit-testable without a DB. Not a live subscription-cycle
// anchor (no subscriptions exist yet); see the schema comment on
// UsageRecord.usagePeriodStart for why there's no separate UsagePeriod
// table backing this.
export function usagePeriodStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

type TransactionClient = Prisma.TransactionClient | PrismaClient;

// Called from inside submitVerification's existing transaction, only after
// analysis has actually produced an assessment — never at upload-received
// time. That placement is what makes this "a billable verification is a
// successfully accepted document analysis": a file that fails validation or
// throws mid-analysis never reaches this call, so retries/failed
// uploads/corrupted files/server errors never consume usage.
export async function recordUsage(
  tx: TransactionClient,
  params: {
    organizationId: string;
    userId: string;
    verificationRequestId: string;
    platform: ClientPlatform;
    at: Date;
  },
): Promise<void> {
  await tx.usageRecord.create({
    data: {
      organizationId: params.organizationId,
      userId: params.userId,
      verificationRequestId: params.verificationRequestId,
      platform: params.platform,
      usagePeriodStart: usagePeriodStart(params.at),
    },
  });
}
