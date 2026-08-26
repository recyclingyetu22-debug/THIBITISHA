import { PrismaClient } from "@prisma/client";

// Default maxWait (2s) is tuned for isolated transactions, not the
// intentional serialization on DocumentNumberCounter (documentNumber.ts) —
// under genuine burst concurrency (e.g. many orgs registering documents at
// once), later transactions legitimately queue for the row lock, and 2s is
// too tight for that queue to drain rather than a sign of anything wrong.
// Proven by test/documentNumberConcurrency.test.ts (24 concurrent writers).
export const prisma = new PrismaClient({
  transactionOptions: { maxWait: 10_000, timeout: 15_000 },
});
