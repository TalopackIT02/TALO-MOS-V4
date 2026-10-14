# Module `auth` — Authentication (AUTH-IMPLEMENTATION-E2E)

Implements `AUTH-API-v1.md` / `AUTH-API-v1.yaml` (contract v1, AUTH-B1.1) on PostgreSQL IAM v0.3 as role `talo_app`.
No grant beyond AUTH-DB-F2 is needed (proved by `test/integration/auth/auth.privileges.test.ts`).

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/login` | Activation Session (15 min) or Authenticated Session (10 h, 60 min idle) |
| `POST /api/auth/password/first-change` | first personal password; account → ACTIVE; all sessions revoked; log in again |
| `GET /api/auth/session` | describe the session (never extends an Activation Session) |
| `POST /api/auth/logout` | revoke the current session; always 204 |

## Files

| File | Content |
|---|---|
| `auth.repository.ts` | every SQL statement (H-b RESERVE, SUCCESS / first-change transactions, sessions, audit) |
| `auth.service.ts` | flows §4–§7, retry once on 40P01/40001 then 503, audit entries |
| `auth.routes.ts` | Express handlers, cookie, rate limit, error envelope |
| `passwordHasher.ts` | Argon2id (`@node-rs/argon2`, local m=19 MiB t=2 p=1), dummy hash, ONE global queue (IB-3) |
| `passwordPolicy.ts`, `blocklist.ts` | AD-6 / P-4 rules; blocklist is an INTERIM seed (P-4a/b PENDING) |
| `sessionCookie.ts`, `rateLimiter.ts`, `audit.ts`, `sqlstate.ts`, `auth.settings.ts`, `auth.messages.ts` | helpers and contract constants |

Contract constants live in `auth.settings.ts` and cannot be changed by configuration or endpoint. Tests may pass shorter
intervals **in-process only** (`createAuthModule({ settings })`) to exercise expiry branches.

## Run locally

Requirements: Docker container `talo-mos-v4-postgres` (127.0.0.1:5433), root `.env` with
`DATABASE_URL=postgresql://talo_app:<password>@127.0.0.1:5433/talo_mos_v4_test` (git-ignored; never commit it).

```text
cd backend  && npm run dev        # API on http://127.0.0.1:3000 (auth mounted when DATABASE_URL is set)
cd frontend && npm run dev        # UI on  http://127.0.0.1:5173, /api proxied to :3000 (TALO_API_TARGET to change)
```

Accounts are provisioned outside this API (IT, role `talo_provisioner`, P-10 / P-4e PENDING).

## Tests

```text
cd backend
npm test                                                     # unit + HTTP branches without a database
TALO_AUTH_PRIV=1 npx vitest run test/integration/auth/auth.privileges.test.ts   # EXPLAIN-only privilege proof
TALO_AUTH_DB=1  npx vitest run test/integration/auth         # PostgreSQL runtime: contract matrix, INV-10, IB-1..3, CT-R1..R4
cd ../tests
npx playwright test -c playwright.auth.config.ts             # browser E2E: own servers on :3100 / :5174
npx playwright test login-layout-geometry --project=react-dev # Login layout identical to HTML v2 (colours only changed)
```

DB suites write only synthetic `AUTHT-` rows in `talo_mos_v4_test` through `talo_test_harness` / `talo_app` and delete
them by UUID afterwards (`test/support/authFixtures.ts`); they refuse to start when leftovers exist.
