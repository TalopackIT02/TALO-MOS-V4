# TALO-MOS-V4 — Authentication API v1 (contract)

**Status:** DRAFT for review (AUTH-B1.1). Design only — no endpoint is implemented. Machine-readable companion:
`AUTH-API-v1.yaml` (OpenAPI 3.1). Baseline: Phase B0 decisions, AUTH-DB-F2, AUTH-SC5-V1 (H-b), AUTH-B1 approval.

Marking: **DECIDED** = approved by the user; **PENDING** = parameter not yet decided or behaviour not yet verified.
Nothing below changes IAM v0.3, its grants, or the Login UI of Phase A.

---

## 1. Scope

| Endpoint | Purpose | Caller |
|---|---|---|
| `POST /api/auth/login` | Verify username + password, issue an Activation Session or an Authenticated Session | anyone |
| `POST /api/auth/password/first-change` | Set the first personal password, activate the account, revoke all sessions | Activation Session only |
| `GET /api/auth/session` | Describe the current session (no extension of an Activation Session) | Activation or Authenticated Session |
| `POST /api/auth/logout` | Revoke the current session; always 204 | anyone |

Out of scope: authorization/permissions, account/role management, password recovery (AD-8 F1: the UI only tells the
user to contact an administrator), email verification (assurance level 2), AppShell, MFA.

## 2. Common transport rules (DECIDED)

| Rule | Value |
|---|---|
| Base path | `/api` (Express app from AUTH-FOUNDATION-F1) |
| Content type | requests and responses `application/json; charset=utf-8`; body limit 10 kB |
| CSRF X1 | every `POST` must carry an `Origin` equal to an `APP_ORIGIN` entry (dev `http://127.0.0.1:5173`) and `Content-Type: application/json` — even without a body. Otherwise `403 ORIGIN_NOT_ALLOWED` / `415 UNSUPPORTED_MEDIA_TYPE`. No CORS headers are ever sent. |
| Caching | every response `Cache-Control: no-store` |
| Request id | server-generated `X-Request-Id` (UUID v4) on every response; client-supplied ids are ignored |
| Security headers | Helmet defaults |
| Time | every security decision uses PostgreSQL time (`statement_timestamp()`), never the application clock (F2-07b) |
| Trust proxy | off unless `TRUST_PROXY` is a hop count or proxy list (never `true`) |

### 2.1 Error envelope (DECIDED)

```json
{ "error": { "code": "INVALID_CREDENTIALS", "message": "<Vietnamese text — P-11>", "requestId": "<uuid>" } }
```

Optional `error.details` is used **only** by `PASSWORD_POLICY` (§5.3). Stack traces, SQL/Prisma details and audit
reason codes never reach the client.

### 2.2 Error codes

| HTTP | `code` | Raised by | Depends on account state? |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | malformed input (types, missing fields, length/byte limits on login, control characters — P-4c) | no — input only |
| 400 | `PASSWORD_POLICY` | first-change: new password rejected by policy (§5.3) | caller already authenticated |
| 400 | `INVALID_JSON` | body is not JSON | no |
| 401 | `INVALID_CREDENTIALS` | login: every unauthenticated failure (§4.2) — **uniform** | must not be observable (INV-10) |
| 401 | `SESSION_INVALID` | missing / unknown / expired / idle / revoked / ineligible session | caller presented a cookie |
| 403 | `ACCOUNT_NOT_ALLOWED` | login with the **correct** password, account or membership ineligible (AD-3) | only after proof of the password |
| 403 | `PASSWORD_CHANGE_REQUIRED` | an Activation Session calls an endpoint outside its allowlist | — |
| 403 | `NOT_REQUIRED` | first-change called with an Authenticated Session | — |
| 403 | `ORIGIN_NOT_ALLOWED` | CSRF X1 | no |
| 404 | `NOT_FOUND` | unknown route | no |
| 413 | `PAYLOAD_TOO_LARGE` | body > 10 kB | no |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | non-JSON content type on POST | no |
| 429 | `RATE_LIMITED` | IP rate limit, evaluated **before** any Argon2 work (P-5) — thresholds PENDING (P-7) | no — per IP |
| 500 | `INTERNAL_ERROR` | unexpected error (never on a code path that depends on the account during login, see §4.4) | — |
| 503 | `SERVICE_BUSY` | password-hashing queue full / timed out — PENDING with P-6b | no — global |

## 3. Sessions and cookie

### 3.1 Cookie (DECIDED, AD-4)

```
Set-Cookie: talo_sid=<token>; HttpOnly; SameSite=Strict; Path=/            (+ Secure in production)
```

- Session cookie: **no `Max-Age`, no `Expires`**. Server-side expiry is authoritative.
- `<token>`: 32 random bytes, base64url. Stored only as `iam_sessions.session_token_hash` = SHA-256 hex. Never logged.
- Cleared with `talo_sid=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/` on logout, invalid session, and after a
  successful first-change.
- "Ghi nhớ tên đăng nhập" (R4 + S1) is purely client-side (`localStorage`, username only). The API has **no**
  `remember` field and the checkbox never influences sessions.

### 3.2 Two session kinds (DECIDED, AD-4 / P-1)

| | Activation Session | Authenticated Session |
|---|---|---|
| Issued when | login succeeds, `must_change_password = true`, account `PROVISIONED` (or `ACTIVE` with a forced change), eligible | login succeeds, `must_change_password = false`, account `ACTIVE`, eligible |
| `expires_at` | `created_at + 15 minutes`, never extended | `created_at + 10 hours`, never extended |
| Idle timeout | not applicable (15 min < 60 min) | 60 min on `last_seen_at` (updated at most once per minute by any authenticated request) |
| `assurance_level_snapshot` | 0 | 1 (level 2 = email verification, out of scope) |
| Per account | at most **one** live (AS-1, enforced under the account lock) | unlimited (C1) |
| Allowed endpoints | `POST /api/auth/password/first-change`, `GET /api/auth/session`, `POST /api/auth/logout` — nothing else (403 `PASSWORD_CHANGE_REQUIRED`) | all authenticated endpoints of later phases |
| Kind is derived | from `must_change_password` **at request time** (no schema column) | same |

### 3.3 Session validation (every request carrying `talo_sid`)

One read (VALIDATE_SESSION, `backend/test/model/sc5/sc5-protocol.sql`) on DB time. The session is **invalid** — answer
`401 SESSION_INVALID`, clear the cookie, revoke it lazily and audit — when any of:

1. no row for `SHA-256(token)`, or `revoked_at IS NOT NULL`;
2. `expires_at <= statement_timestamp()`;
3. Authenticated Session and `last_seen_at <= statement_timestamp() - 60 min`;
4. account `LOCKED` or `DISABLED` (`disabled_at` set) — AD-3;
5. membership `EXITED`, or `left_at <= (statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date` — AD-3 / J2;
6. `must_change_password = true` and the session is older than 15 minutes (activation rules apply to any session while
   a change is pending);
7. `must_change_password = true` and more than one live session exists for the account (AS-1 defence — fail closed);
8. `must_change_password = false` and the session is an activation session (`assurance_level_snapshot = 0`).

ON_LEAVE memberships are valid for authentication; business permissions during leave belong to the future
Authorization Layer.

## 4. `POST /api/auth/login`

### 4.1 Request

```json
{ "username": "NV0001", "password": "…" }
```

| Field | Rule (input-only, before any database access) |
|---|---|
| `username` | string, trimmed, 1–80 characters; looked up with `lower(username) = lower($1)` (expression index `uq_iam_account_username`) |
| `password` | string, **not trimmed**, NFC-normalised, 1–128 code points and ≤ 512 UTF-8 bytes (upper bounds only — P-4); control characters PENDING (P-4c) |

Violations → `400 VALIDATION_ERROR` (independent of the account).

### 4.2 Processing order (DECIDED, P-5 / SC-5 H-b)

1. IP rate limit (PENDING thresholds P-7) → `429`.
2. Input validation → `400`.
3. Look up account + credential + membership (one query).
4. **RESERVE** (single atomic UPDATE, H-b): grants slot 1..5 of the current cycle, sets `locked_until = now + 15 min`
   at slot 5, restarts the cycle lazily when the lock expired, bumps the credential version
   `updated_at = GREATEST(statement_timestamp(), updated_at + 1 µs)`, returns `slot`, `version` (as text),
   `password_hash`, `reserved_at`. No row → locked or budget exhausted.
5. **Exactly one Argon2id verification** per request: real hash when a slot was granted, otherwise the dummy hash
   (unknown username, no credential, locked, no slot). Runs outside any transaction and without a DB connection.
6. Wrong password → audit `LOGIN/FAILURE` (no credential write — the attempt was counted at RESERVE) → uniform 401.
7. Correct password → **SUCCESS transaction** (READ COMMITTED, lock order account → credential → sessions):
   - `FOR NO KEY UPDATE` on the account row, then on the credential row (talo_app never locks the membership — F2-04);
   - re-read eligibility and lock state in a new statement (fresh snapshot after the locks);
   - `password_hash` changed since RESERVE → uniform 401 (`CREDENTIAL_CHANGED`);
   - `statement_timestamp() - reserved_at > 30 s` (D) → uniform 401 (`ATTEMPT_EXPIRED`), no reset;
   - CAS reset `failed_attempt_count = 0, locked_until = NULL` **only if** `updated_at = version` (no write since this
     attempt's RESERVE) — a stale SUCCESS never resets/unlocks a newer cycle;
   - locked now and not reset → uniform 401 (`TEMP_LOCKED`);
   - membership/account ineligible → `403 ACCOUNT_NOT_ALLOWED`;
   - activation: revoke every live session of the account, insert the Activation Session (15 min);
     otherwise insert the Authenticated Session (10 h); `created_at`, `expires_at`, `last_seen_at` from DB time
     (raw INSERT — not Prisma `create`, which would send the application clock);
   - audit (INSERT without `RETURNING`), commit.

### 4.3 Responses

| HTTP | Body | Cookie | Audit (`LOGIN`) |
|---|---|---|---|
| 200 | `{ "status": "AUTHENTICATED", "account": { "userAccountId", "username", "fullName" }, "assuranceLevel": 1, "expiresAt", "serverTime" }` | Authenticated Session | `SUCCESS / OK` |
| 200 | `{ "status": "PASSWORD_CHANGE_REQUIRED", "account": { "username" }, "expiresAt", "serverTime" }` | Activation Session | `SUCCESS / PASSWORD_CHANGE_REQUIRED` |
| 401 | `INVALID_CREDENTIALS` (uniform) | none | `FAILURE` or `DENIED`, reason below |
| 403 | `ACCOUNT_NOT_ALLOWED` | none | `DENIED / ACCOUNT_DISABLED · ACCOUNT_LOCKED · MEMBERSHIP_EXITED · MEMBERSHIP_LEFT_DATE_PASSED` |
| 400 / 403 / 413 / 415 / 429 / 503 | see §2.2 | none | none (no account involved) |

`expiresAt` and `serverTime` are ISO-8601 strings from PostgreSQL; the client shows remaining time from their
difference, never from its own clock (D-UI-2). AD-9 N1: after `AUTHENTICATED` the Phase B frontend stays on the Login
screen and shows a success message (test state only).

### 4.4 Uniform 401 — INV-10 (DECIDED P-5; verification PENDING until implemented)

All of: unknown username, no credential, wrong password, attempt that triggers the lock, temporarily locked / no slot,
`CREDENTIAL_CHANGED`, `ATTEMPT_EXPIRED`, a stale SUCCESS refused because the cycle is locked, and a transient database
error after verification (§9) produce:

- status `401`, `code: INVALID_CREDENTIALS`, the same `message`;
- the same headers (no `Set-Cookie`, no `Retry-After`, same `Cache-Control`, same content type and length);
- bodies identical **except `requestId`**, which is random for every request and independent of the account;
- exactly one Argon2id verification with the production parameters (dummy hash created at startup with the same
  parameters from a random, never-stored secret).

No response-time floor (P-5). Timing distributions per branch are measured and reported, not guaranteed. A 403 is
returned only after the correct password was proven (accepted disclosure, B0 SC-7).

## 5. `POST /api/auth/password/first-change`

### 5.1 Request (DECIDED D-B1-2, D-UI-1)

```json
{ "newPassword": "…" }
```

- Requires a valid **Activation Session** cookie. No current/temporary password is asked again (D-B1-2).
- The confirmation field of the UI (D-UI-1) is compared **client-side**; the API receives only `newPassword`.

### 5.2 Processing

1. Session validation (§3.3); not an Activation Session → `403 NOT_REQUIRED`; invalid → `401 SESSION_INVALID`.
2. IP rate limit (P-7).
3. Policy checks (§5.3) on the NFC-normalised value; failure → `400 PASSWORD_POLICY`.
4. Argon2id hash of the new password (outside any transaction).
5. Transaction (READ COMMITTED; lock order account → credential):
   - `FOR NO KEY UPDATE` account, credential; re-check the Activation Session (not revoked, < 15 min), eligibility;
   - `UPDATE iam_credentials SET password_hash, password_changed_at = now, must_change_password = false,
     failed_attempt_count = 0, locked_until = NULL, updated_at = <version bump> WHERE must_change_password = true`
     — exactly one row, otherwise a concurrent change won (`401 SESSION_INVALID`, audit `CONCURRENT_CHANGE`);
   - `PROVISIONED` → `ACTIVE`, `activated_at = now` (AD-2 L1);
   - revoke **all** sessions of the account, including the current Activation Session (V1);
   - audit `CHANGE_PASSWORD/SUCCESS` and, when activated, `ACCOUNT_ACTIVATED/SUCCESS`; commit.
6. Response `200 { "status": "PASSWORD_CHANGED_RELOGIN" }` and clear the cookie. **No Authenticated Session is issued:
   the user must log in again with the new password (D-B1-1).**

### 5.3 Password policy (DECIDED AD-6 / P-4; parts PENDING)

| Rule | Status | `details.reason` |
|---|---|---|
| NFC normalisation before every check and before hashing; no trimming | DECIDED | — |
| ≥ 15 Unicode code points | DECIDED | `TOO_SHORT` |
| ≤ 128 code points | DECIDED | `TOO_LONG` |
| ≤ 512 UTF-8 bytes | DECIDED | `TOO_LONG_BYTES` |
| No composition rules | DECIDED | — |
| Whole-password match against the offline blocklist (never substrings) | DECIDED; source, size, update process PENDING (P-4a/b) | `BLOCKLISTED` |
| Whole-password match against contextual entries (username, employee code, name variants, brand names + fixed suffixes) | DECIDED principle; case-folding and variant list PENDING (P-4d) | `CONTEXT_MATCH` |
| Must differ from the current (temporary) password — checked with Argon2id verify against the current hash | RECOMMENDED | `SAME_AS_CURRENT` |
| Control characters C0/C1 | PENDING (P-4c) | `CONTROL_CHARACTERS` |

The response states the reason (NIST 800-63B-4) but never reveals the matched blocklist entry:

```json
{ "error": { "code": "PASSWORD_POLICY", "message": "…", "requestId": "…", "details": { "reason": "TOO_SHORT", "minLength": 15 } } }
```

## 6. `GET /api/auth/session`

| Session | Response |
|---|---|
| Authenticated | `200 { "status": "AUTHENTICATED", "account": {…}, "assuranceLevel": 1, "expiresAt", "idleExpiresAt", "serverTime" }` — counts as activity (touches `last_seen_at`, at most once per minute) |
| Activation | `200 { "status": "PASSWORD_CHANGE_REQUIRED", "account": { "username" }, "expiresAt", "serverTime" }` — never extends the session |
| none / invalid | `401 SESSION_INVALID`, cookie cleared |

The frontend must not poll this endpoint (it would keep an Authenticated Session from becoming idle). The Activation
countdown (D-UI-2) is computed from `expiresAt - serverTime` once, then from the local monotonic clock; the server alone
decides expiry.

## 7. `POST /api/auth/logout`

- Always `204`, with the cookie cleared — also without a cookie or with an invalid one (idempotent).
- Revokes the current session only (O1), `revoked_at = statement_timestamp()`; audit `LOGOUT/SUCCESS` when a live
  session was revoked.
- CSRF X1 applies (Origin + `Content-Type: application/json`, empty body allowed).

## 8. Eligibility and the writer protocol (DECIDED AD-3, SC5-V1)

| Condition | Login | Existing session |
|---|---|---|
| Account `LOCKED` / `DISABLED` | refused (403 after correct password) | invalid (401) |
| Membership `EXITED` | refused | invalid |
| Membership `ACTIVE` / `ON_LEAVE`, `left_at` NULL or after today (Asia/Ho_Chi_Minh) | allowed | valid |
| `left_at` ≤ today | refused | invalid |
| `joined_at` in the future | not blocked in Phase B | — |

**Mandatory writer protocol** for every future module that changes eligibility (membership status / `left_at`, account
status / `disabled_at`): one transaction that (1) locks every affected account row `FOR NO KEY UPDATE` in ascending
`user_account_id` order, (2) writes the change, (3) revokes the affected sessions, (4) audits, (5) commits. This lock
couples with the SUCCESS transaction; opposite lock orders deadlock (verified, SC5 B9). A writer that does not comply
only gets the weaker "refused at the next request" guarantee.

**Credential version rule**: every writer of `iam_credentials` bumps
`updated_at = GREATEST(statement_timestamp(), updated_at + interval '1 microsecond')`.

## 9. Concurrency, retries and limits

| Topic | Rule |
|---|---|
| RESERVE | single autocommit statement on one row: no deadlock, no serialization failure in READ COMMITTED |
| SUCCESS / first-change transactions | retry **once** on `40P01` (deadlock) or `40001` (serialization) — login only while still within D = 30 s, first-change only while the Activation Session is still valid; never a second reservation |
| After the retry fails | login → uniform `401` (audit `FAILURE / TRANSIENT_DB_ERROR`) so that contention never becomes an enumeration signal; first-change / logout / session → `500 INTERNAL_ERROR` |
| Retry path | implemented in the SC5 prototype, **not yet triggered by a test** — PENDING (contract tests CT-R1/R2) |
| Guarantees | INV-1…INV-9 verified on PostgreSQL (SC5-V1); **G3/G4 not guaranteed** (published); INV-10 PENDING (needs the API) |

## 10. Argon2id (DECIDED P-6a; P-6b PENDING)

- Library `@node-rs/argon2`, algorithm **Argon2id declared explicitly**, PHC strings; no own encoder/decoder.
- Parameters (memory, iterations, parallelism), maximum concurrent hash/verify operations, p95 target and the queue
  timeout → **PENDING (P-6b)**, to be chosen by benchmark on the target hardware.
- The dummy hash uses the same parameters as real hashes. No pepper in Phase B. Re-hashing on parameter change is not
  part of Phase B.

## 11. Audit (DECIDED structure; P-8 PENDING)

All audit rows are written by `talo_app` with `INSERT` **without `RETURNING`**, in the same transaction as the state
change. Never logged or stored: passwords, tokens, hashes, a username that did not match an account, request bodies.

| `action_code` | `outcome` | `reason` (closed set) |
|---|---|---|
| `LOGIN` | `FAILURE` | `UNKNOWN_USERNAME`, `NO_CREDENTIAL`, `BAD_PASSWORD`, `LOCK_TRIGGERED` (failed slot 5), `CREDENTIAL_CHANGED`, `ATTEMPT_EXPIRED`, `TRANSIENT_DB_ERROR` |
| `LOGIN` | `DENIED` | `TEMP_LOCKED`, `ACCOUNT_DISABLED`, `ACCOUNT_LOCKED`, `MEMBERSHIP_EXITED`, `MEMBERSHIP_LEFT_DATE_PASSED` |
| `LOGIN` | `SUCCESS` | `OK`, `PASSWORD_CHANGE_REQUIRED` |
| `CHANGE_PASSWORD` | `SUCCESS` / `FAILURE` / `DENIED` | `OK` / `POLICY_VIOLATION` (+ `policy` = §5.3 reason) / `SESSION_INVALID`, `CONCURRENT_CHANGE`, `ACCOUNT_NOT_ALLOWED` |
| `ACCOUNT_ACTIVATED` | `SUCCESS` | `OK` |
| `LOGOUT` | `SUCCESS` | `OK` |
| `SESSION_INVALIDATED` | `DENIED` | `SESSION_EXPIRED`, `SESSION_IDLE`, `ACTIVATION_EXPIRED`, `ACTIVATION_INVARIANT_VIOLATION`, `ELIGIBILITY_LOST` |

Columns: `actor_account_id` = NULL for unauthenticated failures, the account for authenticated actions;
`target_type` = `USER_ACCOUNT` or `SESSION`; `target_id` = account (NULL for an unknown username); `session_id` when
known; `occurred_at` = DB time. `metadata` (versioned, built by one function only):
`{ "v": 1, "reason": "…", "requestId": "…", "slot"?: n, "policy"?: "…" }` — `ip` / `ua` and retention **PENDING (P-8)**.

## 12. Contract test matrix (to be implemented with the API; DB tests on `talo_mos_v4_test`)

| ID | Area | Case | Expected |
|---|---|---|---|
| CT-L1 | login | active account, correct password | 200 AUTHENTICATED, cookie flags exact (HttpOnly, SameSite=Strict, Path=/, no Max-Age/Expires; Secure in production config) |
| CT-L2 | login | provisioned account | 200 PASSWORD_CHANGE_REQUIRED, activation cookie, `expiresAt - serverTime = 15 min` |
| CT-L3 | INV-10 | unknown user / wrong password / slot-5 failure / locked / no credential / credential changed / attempt expired / stale-locked / transient DB error | status, headers and body identical after removing `requestId`; one Argon2 call each (spy); timing distribution per branch reported |
| CT-L4 | AD-5 | 5 wrong → lock 15 min; 6th refused; correct 5th logs in | as SC5 A1–A4, through HTTP |
| CT-L5 | AD-3 | EXITED / left_at today / LOCKED / DISABLED with the correct password | 403 ACCOUNT_NOT_ALLOWED; wrong password → uniform 401 |
| CT-L6 | input | over-long password, wrong types, missing fields | 400 VALIDATION_ERROR before any DB access |
| CT-L7 | rate limit | above threshold | 429 before Argon2 (spy: 0 calls) — thresholds PENDING |
| CT-F1 | first-change | valid change | 200 PASSWORD_CHANGED_RELOGIN, cookie cleared, all sessions revoked, account ACTIVE, old password rejected, new password logs in |
| CT-F2 | policy | each §5.3 reason | 400 PASSWORD_POLICY with `details.reason`; no blocklist entry disclosed |
| CT-F3 | concurrency | two first-change requests in parallel | exactly one 200; the other 401 SESSION_INVALID; one new hash |
| CT-F4 | allowlist | activation session calls another authenticated endpoint | 403 PASSWORD_CHANGE_REQUIRED |
| CT-F5 | expiry | activation session older than 15 min (DB time) | 401 SESSION_INVALID |
| CT-F6 | wrong kind | Authenticated Session calls first-change | 403 NOT_REQUIRED |
| CT-S1 | session | full / activation / none | 200 shapes; 401 SESSION_INVALID |
| CT-S2 | idle / absolute | `last_seen_at` 61 min ago; `expires_at` passed | 401, cookie cleared, audit SESSION_INVALIDATED |
| CT-S3 | eligibility | writer protocol exits membership | next request 401 |
| CT-S4 | AS-1 | two live sessions while `must_change_password` | 401 for both (fail closed) |
| CT-O1 | logout | valid / missing / invalid cookie | 204 always; revoked once; cookie cleared |
| CT-X1 | CSRF | POST without Origin, foreign Origin, `localhost` vs `127.0.0.1`, non-JSON | 403 / 415; no CORS headers |
| CT-X2 | headers | every endpoint | `Cache-Control: no-store`, `X-Request-Id`, Helmet headers |
| CT-A1 | audit | every branch | expected action/outcome/reason; metadata keys ⊆ allowlist; no password/token/hash/attempted username anywhere (DB + logs) |
| CT-R1 | retry | injected `40P01` once in SUCCESS | one retry, success |
| CT-R2 | retry | injected `40P01` twice / retry beyond D | uniform 401, `TRANSIENT_DB_ERROR`, no reset |
| CT-T1 | DB time | application clock skewed (fake timers) | no effect on lock, expiry or deadline decisions |
| CT-P1 | privileges | whole suite as `talo_app` | no grant change needed |

## 13. PENDING parameters (not invented here)

| ID | Item |
|---|---|
| P-4a / P-4b | blocklist source, licence, size, update process |
| P-4c | control characters C0/C1 |
| P-4d | case-folding and contextual variant list |
| P-4e | policy for IT-issued temporary passwords |
| P-6b | Argon2id parameters, concurrency limit, p95, queue timeout (→ `503 SERVICE_BUSY`) |
| P-7 | IP rate-limit thresholds and windows |
| P-8 | IP / user-agent in audit metadata; audit retention |
| P-10 | provisioning role and tool |
| P-11 | Vietnamese messages (AUTH-B1.3) |
| INV-10, CT-R1/R2 | verification once the API exists |
