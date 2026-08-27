# Debian-based, not Alpine — Alpine's musl libc keeps causing Prisma engine
# binaries (both the query engine and the separate migration/schema engine
# used by `prisma migrate deploy`) to mismatch against whatever OpenSSL
# version is actually present, crashing at runtime. Debian's glibc + OpenSSL
# combination is the well-supported path for every Prisma engine binary, no
# per-engine binaryTargets juggling required.
FROM node:20-slim

WORKDIR /app

# Prisma's engines need OpenSSL and certificate authorities available at
# runtime, not just at build time.
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npx prisma generate
RUN npm run build

EXPOSE 4000
# Applies any pending migrations against the production database before
# every boot — safe to run repeatedly (a no-op once the DB is up to date),
# and means a fresh Postgres (like Railway's, which starts empty) gets its
# schema created automatically on first deploy instead of failing on the
# first query.
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
