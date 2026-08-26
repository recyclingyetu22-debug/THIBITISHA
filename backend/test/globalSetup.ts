import { execSync } from "node:child_process";

// Runs once before the whole test run, in a separate process context (no
// access to the app's module registry) — just needs the test DATABASE_URL
// to exist and be reachable. Pushes the current Prisma schema onto it so
// `vitest run` is self-sufficient given a running Postgres.
export default function globalSetup() {
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://document_sentinel:document_sentinel@localhost:5432/document_sentinel_test";

  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}
