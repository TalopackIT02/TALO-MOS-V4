# Module `auth` — architectural boundary (Foundation F1)

**Status: no implementation.** Foundation F1 only reserves this boundary. There are no routes, services or
repositories here, and no `/api/auth/*` endpoint exists. Implementation requires a separate, approved task.

## Responsibility (when implemented)

Authentication against PostgreSQL IAM v0.3 (`iam` schema): login, logout, session validation and the
first-time password change, following the approved **Phase B0 Authentication Decision & Security Contract**.

Out of scope for this module: authorization (effective permissions, ON_LEAVE business rights), account /
role / permission management, AppShell, email verification, password recovery flows.

## Decided contract highlights (Phase B0)

| Area | Decision |
|---|---|
| Membership | `ACTIVE`/`ON_LEAVE` may log in while `left_at` is null or after today (Asia/Ho_Chi_Minh); `EXITED` denied; account `LOCKED`/`DISABLED` always denied |
| Sessions | Server-side; token hash stored in `iam_sessions`; 10 h absolute, 60 min idle; HttpOnly session cookie |
| Activation session | 15 min absolute, no extension; only `POST /api/auth/password/first-change`, `GET /api/auth/session`, `POST /api/auth/logout` |
| Remember me | Remembers the **username** only (frontend `localStorage`); no effect on sessions; no `remember` field in the API |
| Lockout | 5 failed attempts → `locked_until` = 15 min; never sets `account_status = LOCKED` |
| Passwords | Argon2id via `@node-rs/argon2` (PHC strings); NFC; 15–128 code points, ≤ 512 UTF-8 bytes; no trimming; no composition rules; offline + contextual blocklist |
| Enumeration | One uniform 401 response; dummy Argon2id verification for unknown user / no credential / locked / no reservation; IP rate limit before hashing |
| CSRF | X1: SameSite=Strict cookie, Origin allowlist (`core/middleware/originCheck.ts`), JSON content type |

## Open items before implementation

- SC-5 attempt-reservation algorithm: must be verified (concurrency, generation resets, stale SUCCESS) and approved.
- P-6b Argon2id parameters/benchmark, rate-limit thresholds, audit IP/UA & retention, message copy, provisioning role.
- Least-privilege DB role `talo_app` validated on the test database (scripts in `database/scripts/foundation-f1/`, not yet run).

## Dependencies this module will use

- `core/*` (errors, HTTP envelope, origin check, logging) — never logs passwords, tokens, cookies or bodies.
- `infrastructure/prisma/client.ts` — the only source of the Prisma client.
- The Prisma models in `database/prisma/schema.prisma` (note: partial/expression indexes are DB-only).
