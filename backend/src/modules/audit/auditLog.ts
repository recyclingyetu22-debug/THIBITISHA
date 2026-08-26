import type { Prisma, PrismaClient } from "@prisma/client";

// Append-only by convention: this is the only writer the app uses for
// AuditLog, and it only ever creates rows (spec §29/§57).
export async function recordAuditEvent(
  db: PrismaClient | Prisma.TransactionClient,
  params: {
    organizationId: string;
    userId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.auditLog.create({
    data: {
      organizationId: params.organizationId,
      userId: params.userId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: params.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}
