import { prisma } from "../../db/client.js";

export async function listActivePlans() {
  return prisma.plan.findMany({
    where: { active: true },
    include: { pricing: { where: { active: true } } },
    orderBy: { createdAt: "asc" },
  });
}
