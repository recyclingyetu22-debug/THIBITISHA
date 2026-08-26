import { z } from "zod";
import { Role } from "@prisma/client";

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(200),
  password: z.string().min(10, "Password must be at least 10 characters"),
  roles: z.array(z.nativeEnum(Role)).min(1),
});
