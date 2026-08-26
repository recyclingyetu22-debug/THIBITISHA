import { z } from "zod";
import { DocumentClassification } from "@prisma/client";

// multipart/form-data fields arrive as strings, so this validates the text
// fields alongside the file (checked separately in the route handler).
export const registerDocumentSchema = z.object({
  documentType: z.string().min(1).max(100),
  title: z.string().min(1).max(300),
  issuer: z.string().max(300).optional(),
  ownerName: z.string().max(300).optional(),
  classification: z.nativeEnum(DocumentClassification).default(DocumentClassification.INTERNAL),
});
