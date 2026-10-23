# Project: LotusYoga

## Stack
- Frontend: React 19 + Vite + TypeScript + Tailwind           → lives in `frontend/`
- Backend:  Node 22 + Fastify + TypeScript + PostgreSQL + Prisma → lives in `backend/`
- Infra:    Docker Compose, GitHub Actions                   → root `Dockerfile`/compose, `.github/` (scripts in `.github/scripts/`)
- Tests:    Vitest, Supertest, Playwright                     → `*/tests/`, `e2e/`

## Commands
- Install:  npm ci --silent (in `backend/` and `frontend/`)
- Dev:      docker compose up (or F5 "Backend + UI" in VS Code)
- Lint:     npm run lint
- Test:     npm test -- --reporter=dot  /  e2e: npx playwright test --reporter=line
- Test one file: npm test -- path/to/file.test.ts --reporter=dot

## Rules
- The API contract in `docs/api-contract.md` is the source of truth. Don't change it
  without the brain's approval — report the needed change instead.
- **Dev/test config keys are committed on purpose.** Each app keeps a committed
  `.env.development` and `.env.test` with working values (DB passwords, JWT secrets, test API
  keys…), so a fresh clone runs (F5) and tests pass with no setup. Don't gitignore them, don't
  move them out of the repo, and don't replace them with placeholders.
- These keys are for **local/test only**. Production secrets never go in the repo: they come from
  GitHub Actions secrets or the deployment host's environment. Code must not fall back to a test key
  in production.
- Commit only on your own branch; never push to main.
- Use Conventional Commits (`feat:`, `fix:`, `chore:`, `feat!:` …). CI derives the image
  version from them, so the wrong prefix gives the wrong version bump.

## Token rules (every agent)
- Read only what your task needs: your task IDs' sections of `docs/spec.md` and
  `docs/api-contract.md`, and files in your folders. Use Grep/Glob to find code, then read the
  relevant part, not whole large files.
- Never read generated folders: `node_modules`, `dist`, `build`, `coverage`, lockfiles.
- Quiet commands: tests with `--reporter=dot` (or `--silent`), installs with `--silent`,
  and pipe long output through `| tail -n 50`.
- While fixing, run only the affected test files. Run the full suite once, at the end.
- Read files in `.claude/templates/` only when your task creates or changes that piece.
- Reports: **max ~150 words or one table.** No full logs: quote only the failing lines
  (max 20), and never paste whole files or diffs.
