# StudioBook — Tasks (v1)

| ID | Agent | Task | Files owned | Depends on | Status |
|---|---|---|---|---|---|
| D1 | devops | Add Mailpit to compose (SMTP 1025, UI 8025); add new env keys from contract "Environment variables" to backend `.env.development`/`.env.test` (and compose `app` env + CI); keep Dockerfile in sync (backend `dist/server.js`, `backend/prisma`, `STATIC_DIR`); add Mailpit + e2e to CI if missing | `Dockerfile`, `docker-compose*.yml`, `.github/`, `.vscode/`, all `.env*` files | — | todo |
| B1 | backend | Scaffold Fastify+TS+Prisma app (`package.json`, lint, vitest), Prisma schema + migration, auth, all endpoints in the contract, card/booking/waitlist rules, Sofia-time logic, email outbox + worker + bg/en templates, jobs, initial-admin seed, static UI serving, unit + Supertest tests | `backend/**` except `.env*` | — | todo |
| F1 | frontend | Scaffold React 19+Vite+TS+Tailwind app (`package.json`, lint, vitest), bg/en i18n, API client from contract, client pages (schedule, login/register, my bookings & cards, account/delete), instructor Today page, admin pages (schedule/templates, clients, client history & cards, monthly report), mobile-first, unit tests | `frontend/**` except `.env*` | — (codes against contract) | todo |
| T1 | tester | Integration + Playwright e2e against the merged app covering AC-1…AC-45 | `e2e/**` | B1, F1, D1 | todo |
| S1 | security | Full review (auth, user data, input handling, deps, Docker/CI/env) | read-only | B1, F1, D1 | todo |
