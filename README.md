# THIBITISHA — Document Verification & Forensics

*Verify before you trust.*

Multi-tenant document forensics and verification platform. This is **Phase 1
only**: authentication, organizations/users, document registration with
SHA-256 fingerprinting, and a basic viewer. No OCR, forensics, AI analysis,
QR verification, payments, cases, or watchdog monitoring yet — those are
later phases per the project's phased build plan.

## Structure

- `backend/` — Express + TypeScript + Prisma + Postgres API
- `mobile/` — Expo/React Native app (login, document list, document detail/download)
- `docker-compose.yml` — Postgres + backend for local dev

## Backend setup

```bash
cd backend
cp .env.example .env        # edit JWT secrets before anything but local dev
npm install
docker compose up -d postgres   # from the repo root, or run your own Postgres
npm run prisma:migrate
npm run dev                 # http://localhost:4000
```

Run tests (needs a reachable Postgres — defaults to
`document_sentinel_test` on localhost):

```bash
npm test
```

## Mobile setup

```bash
cd mobile
npm install
npx expo start
```

Edit `app.json`'s `expo.extra.apiBaseUrl` to point at your backend
(`http://10.0.2.2:4000` targets the Android emulator's host machine by
default; use your machine's LAN IP for a physical device).

## API (Phase 1)

- `POST /auth/register-organization` — creates an Organization + its first ORG_ADMIN user
- `POST /auth/login`
- `POST /auth/refresh`
- `GET /organizations/me`
- `GET /users`, `POST /users` (ORG_ADMIN)
- `POST /documents` (multipart, `file` + `documentType`/`title`/...) — registers a document, computes SHA-256, assigns a `DOC-<year>-<seq>` number
- `GET /documents`, `GET /documents/:id`, `GET /documents/:id/download`

All document/user endpoints are organization-scoped: the JWT carries the
caller's `organizationId`, and every query is filtered by it — one
organization can never read another's documents.
