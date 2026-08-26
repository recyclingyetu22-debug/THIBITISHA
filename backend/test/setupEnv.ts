import path from "node:path";

process.env.NODE_ENV = "test";
process.env.PORT = "4001";
process.env.DATABASE_URL ??=
  "postgresql://document_sentinel:document_sentinel@localhost:5432/document_sentinel_test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-not-for-production";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-not-for-production";
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_LOCAL_ROOT = path.resolve(process.cwd(), "storage", "test-uploads");
process.env.MAX_UPLOAD_BYTES = "26214400";
