import pino from "pino";
import { env } from "../config/env.js";

export const logger = pino({
  // Keep test runs quiet but still surface unexpected errors — silencing
  // those too would hide real bugs behind an opaque "expected 500" in tests.
  level: env.NODE_ENV === "test" ? "error" : "info",
});
