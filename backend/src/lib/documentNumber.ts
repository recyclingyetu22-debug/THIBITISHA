import type { Prisma } from "@prisma/client";

// Must run inside the same transaction as the Document insert. Upsert +
// increment on the per-year counter row serializes concurrent registrations
// (across all organizations) via row locking, so numbers never collide or
// skip — see the schema comment on DocumentNumberCounter for why this is a
// global counter rather than one per organization.
export async function nextDocumentNumber(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();

  const counter = await tx.documentNumberCounter.upsert({
    where: { year },
    create: { year, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
  });

  const sequence = String(counter.lastValue).padStart(8, "0");
  return `DOC-${year}-${sequence}`;
}
