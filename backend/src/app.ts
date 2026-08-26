import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { logger } from "./lib/logger.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { organizationsRouter } from "./modules/organizations/organizations.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { documentsRouter } from "./modules/documents/documents.routes.js";
import { verificationRouter } from "./modules/verification/verification.routes.js";
import { billingRouter } from "./modules/billing/billing.routes.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  // The `verify` hook stashes the exact raw bytes on req.rawBody alongside
  // normal JSON parsing — the billing webhook handler needs the untouched
  // byte sequence for HMAC signature verification; re-serializing the
  // parsed req.body would not reliably reproduce the same bytes (key
  // order/whitespace can differ), which would break signature checks.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
      },
    }),
  );
  app.use(pinoHttp({ logger }));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/auth", authRouter);
  app.use("/organizations", organizationsRouter);
  app.use("/users", usersRouter);
  app.use("/documents", documentsRouter);
  // Mounted before verificationRouter deliberately: verificationRouter is
  // mounted with no path prefix and applies requireAuth/attachTenant via a
  // pathless `.use()` inside itself, so it acts as a global auth gate for
  // every request that reaches it — including ones meant for other routers
  // mounted after it. billingRouter's own routes already apply
  // requireAuth/attachTenant individually where needed, but its webhook
  // route is intentionally unauthenticated (called by the payment provider,
  // not a logged-in user) and must never pass through that gate.
  app.use("/billing", billingRouter);
  app.use(verificationRouter);

  app.use(errorHandler);

  return app;
}
