FROM node:20-alpine

WORKDIR /app

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
