# AUTH-SC5-V1 — PostgreSQL integration verification (H-b, D = 30 s, writer protocol)

Approved design: H-b version CAS on `iam_credentials.updated_at`, attempt deadline D = 30 s, mandatory writer protocol
(account-row lock coupling), harness role `talo_test_harness`. This suite runs the protocol on **real PostgreSQL 18
transactions** in `talo_mos_v4_test`. It is a test prototype — not the production authentication module.

## How to run

```text
cd backend
TALO_SC5_DB=1 npx vitest run test/integration/sc5 --reporter=verbose      # PowerShell: $env:TALO_SC5_DB=1; npx vitest …
```

Requirements: `DATABASE_URL` for `talo_app@127.0.0.1:5433/talo_mos_v4_test` in the git-ignored root `.env`; role
`talo_test_harness` (see `database/scripts/sc5-test-harness/`). Without `TALO_SC5_DB=1` the suite is skipped, so
`npm test` never touches a database.

## Actors

| Actor | Role / transport | Does |
|---|---|---|
| Protocol under test | `talo_app` via Prisma + `@prisma/adapter-pg` from the Windows host (TCP, SCRAM) — pool of up to 15 real connections | RESERVE, SUCCESS transaction, audit, session validation |
| Harness | `talo_test_harness` via `docker exec … psql` — one real backend connection per `PsqlSession` (3 used) | fixtures, writer simulation, inspection, cleanup |
| `admin` | not used by the suite | — |

Concurrency is real: parallel RESERVEs run on separate pool connections; blocking is observed as a promise that stays
pending while another connection holds the row lock, then completes after that transaction ends.

## Files

| File | Content |
|---|---|
| `protocol.ts` | H-b prototype (`reserve`, `success`, `recordFailure`, `validateSession`) + negative-control variants (`naive`, `no-lock-coupling`, `activation-no-revoke`, `postIncrementAttempt`) |
| `harness.ts` | `PsqlSession` driver, `Sc5Fixtures` (tagged synthetic data + scoped cleanup), writer protocol steps, credential writers that bump the version |
| `sc5.integration.test.ts` | 29 tests in groups A (lockout), B (eligibility/writers), C (sessions/time), D (privileges), E (negative controls) |

## Data safety

- Fixtures: `employee_code = <runId>-M<n>`, `username = <runId>-u<n>`, random UUIDs, synthetic names, placeholder hashes.
  Collisions with existing ids/codes/usernames are checked before every insert.
- The suite refuses to start if any `SC5T-%` membership already exists (never deletes what it did not create).
- Cleanup after every test: ownership proof (every account belongs to a run membership, every membership carries the run
  tag), then one transaction deleting by UUID list in FK order audit → sessions → credentials → accounts → memberships.
  Audit rows are matched by `metadata->>'run'` plus the run's UUIDs. No TRUNCATE, no whole-table DELETE, no DROP.

## Results (2026-10-14, three consecutive runs, all 29/29 PASS)

Run 1 statistics: 65 scenarios executed on PostgreSQL, 41 of them concurrent; 29 cleanups deleted 172 rows;
remaining run rows 0; total IAM rows in the test database after the run 0. Runs 2 and 3: 29/29 PASS, cleanup complete.

| Group | Tests | Result |
|---|---|---|
| A. Lockout | A1–A3 (1–4 wrong, 5th locks exactly `+15 min` DB time, 6th refused with no hash returned and no write), A4 (4 wrong + correct 5th: login, reset), A5 (expiry → new cycle slot 1), A6 (stale SUCCESS: counter/lock/version untouched, 401), A7 (deadline: real 2.5 s wait with D=2 s, and contract D=30 s with a 31 s old reservation), A8 (10 parallel RESERVEs × 3 rounds → slots 1..5, one lock), A9 (SUCCESS/FAILURE interleavings), A10 (4 wrong + 1 correct fully concurrent × 20 rounds), A11 (password changed mid-attempt) | POSTGRESQL INTEGRATION PASS |
| B. Eligibility | B1 (ACTIVE, ON_LEAVE), B2 (EXITED; `left_at` = today in Asia/Ho_Chi_Minh refused; tomorrow allowed), B3 (LOCKED, DISABLED), B4 (EXITED while verifying), B5 (writer first: SUCCESS blocked ≥ 800 ms, then refused), B6 (SUCCESS first: writer blocked, then revokes the new session; session no longer usable), B7 (`left_at` set while SUCCESS waits), B8 (two writers, UUID order: serialised, no deadlock), B9 (opposite order: one `40P01`) | POSTGRESQL INTEGRATION PASS |
| C. Sessions | C1 (3 concurrent activation logins × 10 rounds → exactly one live activation session), C2 (10 h / 15 min / last_seen = created_at, all DB time), C3 (versions strictly increasing; sub-millisecond digits lost by `Date`), C4 (touch on a revoked session: 0 rows) | POSTGRESQL INTEGRATION PASS |
| D. Privileges | D1 (identities), D2 (talo_app: membership `FOR UPDATE`/`FOR KEY SHARE`, DELETE, audit `RETURNING`, membership UPDATE all `42501`; audit INSERT without RETURNING works) | POSTGRESQL INTEGRATION PASS |
| E. Negative controls | E1 naive reset unlocks a newer cycle; E2 post-increment lets > 5 verifications through; E3 no lock coupling → live session for EXITED; E4 writer without revoke → live session remains; E5 activation without revoke → > 1 live activation session | each bug REPRODUCED (expected) |

A10 observed outcomes for the concurrent correct attempt: `AUTHENTICATED` with reset (it held the last reservation),
`AUTHENTICATED` without reset (it committed before a later wrong attempt locked the cycle), `LOCKED` (a later wrong
attempt locked the cycle before its SUCCESS). All three are the approved H-b behaviour; in none of them was a session
issued while the cycle was locked, and the counter never exceeded 5.

## Invariants

| ID | Model | PostgreSQL | Evidence |
|---|---|---|---|
| INV-1 ≤ 5 real verifications per cycle | MODEL PASS | INTEGRATION PASS | A8, A10, E2 (counter-example) |
| INV-2 `c ≤ N`, `c = N ⇒ locked_until` | MODEL PASS | INTEGRATION PASS | A1–A3, A8, A10 |
| INV-3 correct 5th attempt not locked | MODEL PASS | INTEGRATION PASS | A4 |
| INV-4 no stale reset/unlock | MODEL PASS | INTEGRATION PASS | A6, A7, E1 (counter-example) |
| INV-5 no real verify while locked | MODEL PASS | INTEGRATION PASS | A1–A3 (no row ⇒ no hash), A8 |
| INV-6 no session while locked (except own lock) | MODEL PASS | INTEGRATION PASS | A6, A10 |
| INV-7 eligibility + writer protocol | MODEL PASS | INTEGRATION PASS | B2–B9, C4, E3/E4 (counter-examples) |
| INV-8 one live activation session | MODEL PASS | INTEGRATION PASS | C1, E5 (counter-example) |
| INV-9 security time from PostgreSQL | — | INTEGRATION PASS | A1–A3, A7, B2, C2, C3 |
| INV-10 indistinguishable 401s | — | NOT VERIFIED | needs the authentication API (out of scope) |

## Limits and cross-module assumptions

- **Writer protocol is a contract, not enforced by the schema.** Writers that change eligibility must lock the affected
  account rows (UUID order), write, revoke sessions, in one transaction. A writer that does not comply degrades INV-7 to
  "refused at the next request" (E4). Opposite lock order deadlocks (B9).
- **Version rule is a contract.** Every writer of `iam_credentials` must bump `updated_at` with
  `GREATEST(statement_timestamp(), updated_at + 1 µs)`. PostgreSQL cannot enforce it without a trigger (schema change,
  not proposed). A non-compliant writer could defeat the CAS only if it also restores the exact same version value.
- **G3/G4 not guaranteed** (published earlier): concurrent verifications across a success-opened cycle, and the
  "N per any 15 minutes" bound when legitimate logins interleave.
- **H-b trade-off observed in A9/A10:** a correct attempt that is followed by another reservation in the same cycle logs
  in without resetting the counter, or is refused if that later reservation locked the cycle.
- **Lock expiry is simulated** by moving `locked_until` into the past (A5); the real 15-minute wait was not exercised.
  The boundary `locked_until = now()` is covered by SQL review (`<=` means expired), not by a timed test.
- **Retry path** (one retry on `40P01`/`40001` in SUCCESS) is implemented but was not triggered by any test: SUCCESS uses
  a consistent lock order and never deadlocked; the deadlock in B9 is between two harness writers.
- **Harness role connects without a password** through the container socket (`trust`, F2-06) and, like every role,
  inherits PUBLIC CONNECT/TEMP on `postgres` and `talo_mos_v4_dev` (F2-05) without any table privilege there.
