import multer from "multer";
import { env } from "../config/env.js";

// Buffers the file in memory (Phase 1 caps uploads at MAX_UPLOAD_BYTES, so
// this is bounded) so the documents module can hash + magic-byte check the
// bytes before ever writing them to storage. multer itself rejects anything
// over the limit before the handler runs.
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 },
});
