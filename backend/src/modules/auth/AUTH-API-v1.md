# TALO-MOS-V4 — Authentication API v1 (contract)

**Status:** contract v1 (AUTH-B1.1, finalized). **Design only — no endpoint is implemented yet;** every behaviour below is the
required behaviour of the future implementation. Machine-readable companion: `AUTH-API-v1.yaml` (OpenAPI 3.1).
Baseline: Phase B0 decisions, AUTH-DB-F2, AUTH-SC5-V1 (H-b, verified on PostgreSQL), AUTH-B1 approval.

Marking: **DECIDED** = approved by the user; **VERIFIED** = proven on PostgreSQL in SC5-V1; **PENDING** = a value or
behaviour that is not decided or cannot be verified before the implementation exists.
Nothing below changes IAM v0.3, its grants, the Prisma mapping, or the Login UI of Phase A.

## 0. Authentication lifecycle (DECIDED)

```text
IT provisioning ─► account PROVISIONED, must_change_password = true (temporary password, Argon2id)
      │
      ▼ POST /api/auth/login (correct temporary password, eligible)
Activation Session (15 min absolute, never extended; only first-change / session / logout)
      │
      ▼ POST /api/auth/password/first-change (policy OK)
account ACTIVE, activated_at set, must_change_password = false, counter reset,
ALL sessions revoked (including the Activation Session), cookie cleared
      │
      ▼ the user must log in again — no Authenticated Session is issued by first-change (D-B1-1)
POST /api/auth/login (new password) ─► Authenticated Session (10 h absolute, 60 min idle)
      │
      ▼ POST /api/auth/logout ─► session revoked (always 204)
```

An `ACTIVE` account with `must_change_password = true` (a future forced change) follows the same Activation path.
`LOCKED` / `DISABLED` accounts and ineligible memberships never get a session (AD-3).

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
| 429 | `RATE_LIMITED` | IP rate limit, evaluated **before** any Argon2 work (P-5, P-7): login **60 requests / 15 min / IP** (local, DECIDED); first-change threshold PENDING (§13.2) | no — per IP |
| 500 | `INTERNAL_ERROR` | unexpected, non-retryable error. During login it must not depend on whether the account exists (implementation blocker IB-1, §4.5) | must not (login) |
| 503 | `SERVICE_BUSY` | (a) password-hashing queue full / timed out — limits PENDING (P-6b); (b) unrecoverable database error after the retry limit on `40P01` / `40001` (§9) | (a) no — global; (b) reachable only after proof of the password (login) or with a valid Activation Session (first-change), §4.5 |

## 3. Sessions and cookie

### 3.1 Cookie (DECIDED, AD-4)

```
Set-Cookie: talo_sid=<token>; HttpOnly; SameSite=Strict; Path=/            (+ Secure in production)
```

- Session cookie: **no `Max-Age`, no `Expires`**. Server-side expiry is authoritative.
- `<token>`: 32 random bytes, base64url. Stored only as `iam_sessions.session_token_hash` = SHA-256 hex. Never logged.
- Cleared with `talo_sid=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/` on logout, invalid session, and after a
  successful first-change.
- The session token exists only in this HttpOnly cookie. The frontend never stores tokens, session ids or passwords in
  `localStorage`/`sessionStorage`, and never reads the cookie.
- "Ghi nhớ tên đăng nhập" (R4 + S1, DECIDED) is purely client-side: `localStorage` holds the **username only**, written
  only when the checkbox is checked at a successful login and removed when it is unchecked. The login API has **no**
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
| `password` | string, **not trimmed**, NFC-normalised, 1–128 code points and ≤ 512 UTF-8 bytes (upper bounds only — P-4); no C0 (U+0000–U+001F), DEL (U+007F) or C1 (U+0080–U+009F) control character (P-4c, DECIDED) |

Violations → `400 VALIDATION_ERROR` (independent of the account). A password containing a C0/DEL/C1 character can never
have been set under §5.3, so rejecting it before the lookup hides nothing.

### 4.2 Processing order (DECIDED, P-5 / SC-5 H-b)

1. IP rate limit (P-7, local: 60 login requests per 15 minutes per client IP, counted before validation) → `429`.
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
   - audit (INSERT without `RETURNING`), commit;
   - `40P01` / `40001`: retry the transaction once (§9); when the retry also fails → `503 SERVICE_BUSY` (§4.5).

### 4.3 Responses

| HTTP | Body | Cookie | Audit (`LOGIN`) |
|---|---|---|---|
| 200 | `{ "status": "AUTHENTICATED", "account": { "userAccountId", "username", "fullName" }, "assuranceLevel": 1, "expiresAt", "serverTime" }` | Authenticated Session | `SUCCESS / OK` |
| 200 | `{ "status": "PASSWORD_CHANGE_REQUIRED", "account": { "username" }, "expiresAt", "serverTime" }` | Activation Session | `SUCCESS / PASSWORD_CHANGE_REQUIRED` |
| 401 | `INVALID_CREDENTIALS` (uniform) | none | `FAILURE` or `DENIED`, reason below |
| 403 | `ACCOUNT_NOT_ALLOWED` | none | `DENIED / ACCOUNT_DISABLED · ACCOUNT_LOCKED · MEMBERSHIP_EXITED · MEMBERSHIP_LEFT_DATE_PASSED` |
| 503 | `SERVICE_BUSY` after the retry limit (correct password proven) | none | `FAILURE / TRANSIENT_DB_ERROR` (separate INSERT after rollback) |
| 400 / 403 / 413 / 415 / 429 / 503 (hash queue) | see §2.2 | none | none (no account involved) |

`expiresAt` and `serverTime` are ISO-8601 strings from PostgreSQL; the client shows remaining time from their
difference, never from its own clock (D-UI-2). AD-9 N1: after `AUTHENTICATED` the Phase B frontend stays on the Login
screen and shows a success message (test state only).

### 4.4 Uniform 401 — INV-10 (DECIDED P-5; verification PENDING until implemented)

All of: unknown username, no credential, wrong password, attempt that triggers the lock, temporarily locked / no slot,
`CREDENTIAL_CHANGED`, `ATTEMPT_EXPIRED`, and a stale SUCCESS refused because the cycle is locked produce:

- status `401`, `code: INVALID_CREDENTIALS`, the same `message`;
- the same header set and values (no `Set-Cookie`, no `Retry-After`, same `Cache-Control`, same content type, same
  `Content-Length`), except `X-Request-Id`;
- bodies identical **except `requestId`**;
- exactly one Argon2id verification with the production parameters (dummy hash created at startup with the same
  parameters from a random, never-stored secret).

**`requestId` (DECIDED):** differing `requestId` / `X-Request-Id` values between `INVALID_CREDENTIALS` responses are
accepted. Each is a fresh UUID v4 generated per request before any account lookup, so it carries no account
information; it always has the same length. The error envelope (§2.1) is unchanged. Contract tests replace
`requestId` and `X-Request-Id` by a fixed placeholder, then require byte-identical bodies and identical headers, and
check leakage on three channels: HTTP status, headers, and timing (§12 CT-L3, CT-L10).

A transient database error is **not** part of this list: it never produces a 401 (§4.5, §9).

No response-time floor (P-5). Timing distributions per branch are measured and reported, not guaranteed. A 403 is
returned only after the correct password was proven (accepted disclosure, B0 SC-7).

### 4.5 `503 SERVICE_BUSY` after the retry limit — enumeration analysis (DECIDED rule; INV-10 NOT VERIFIED)

Rule: when the SUCCESS transaction fails with `40P01` / `40001`, it is retried **once** (§9). If the retry fails too,
or no retry is possible because D = 30 s has passed, the response is `503 SERVICE_BUSY` — never `401`. No session, no
counter reset, no second reservation, no second Argon2 verification; audit `LOGIN / FAILURE / TRANSIENT_DB_ERROR`.

Where a retryable error can occur, and who can observe it:

| Step | `40P01` / `40001` possible? | Who reaches it | Account-distinguishing? |
|---|---|---|---|
| Rate limit, validation | no database access | everyone | no |
| Lookup (one `SELECT`, autocommit) | no (single read in READ COMMITTED) | every request | no — same statement for every username |
| RESERVE (one `UPDATE` on one row, autocommit) | no deadlock (one row lock), no serialization failure in READ COMMITTED | existing accounts with a credential only | see IB-1 (non-retryable errors) and IB-2 (timing) |
| Argon2id verify (real or dummy) | no database | every request; queue `503` is global | no |
| FAILURE audit (one `INSERT`, autocommit) | no | every wrong-password path, including unknown usernames | no |
| SUCCESS transaction | **yes** (row locks on account + credential) | **only after the correct password was verified** | discloses at most what `403 ACCOUNT_NOT_ALLOWED` already discloses |
| first-change transaction | **yes** | only with a valid Activation Session | the caller is already authenticated |

Conclusion: the retry-exhaustion `503` is unreachable without the correct password, so it is **not an enumeration
oracle** for a caller who does not know the password; for a caller who does, it discloses nothing beyond the accepted
SC-7 disclosure. This is an argument by construction, not a proof. **INV-10 remains NOT VERIFIED** until the contract
tests run against the implementation; the following are **implementation blockers** (must be resolved and tested
before INV-10 may be reported as passing):

- **IB-1 — non-retryable database errors before proof of the password.** RESERVE runs only for existing accounts with a
  credential, so any error raised there (connection loss, statement timeout, …) would surface only for existing
  accounts. The implementation must make every error path before the password is proven independent of the account
  (same status and body whether or not the username exists); the contract does not fix the mechanism. Test CT-L10.
- **IB-2 — timing.** Unknown usernames skip the RESERVE `UPDATE`; RESERVE of an existing account may wait behind a
  SUCCESS transaction holding the credential row lock. Both differences are small compared with one Argon2id
  verification but are not removed (no time floor, P-5). They are measured per branch (CT-L3) and reported; any
  difference that is distinguishable at the measured sample size is reported as an open finding, not as a pass.
- **IB-3 — `503` hash queue.** The queue limit must be global (not per account) and real and dummy verifications must
  go through the same queue, so a queue `503` cannot correlate with the username. If a queue `503` is returned after
  RESERVE granted a slot, that slot stays consumed (no extra reservation, no refund — DECIDED) — the same for every account.

## 5. `POST /api/auth/password/first-change`

### 5.1 Request (DECIDED D-B1-2, D-UI-1)

```json
{ "newPassword": "…" }
```

- Requires a valid **Activation Session** cookie. No current/temporary password is asked again (D-B1-2).
- The confirmation field of the UI (D-UI-1) is compared **client-side**; the API receives only `newPassword`.

### 5.2 Processing

1. Session validation (§3.3); not an Activation Session → `403 NOT_REQUIRED`; invalid → `401 SESSION_INVALID`.
2. IP rate limit (P-7 principle; threshold for this endpoint PENDING, §13.2).
3. Policy checks (§5.3) on the NFC-normalised value, cheap checks first, then `SAME_AS_CURRENT` (one Argon2id verify
   of the new password against the current `password_hash`); failure → `400 PASSWORD_POLICY`.
4. Argon2id hash of the new password (outside any transaction).
5. Transaction (READ COMMITTED; lock order account → credential):
   - `FOR NO KEY UPDATE` account, credential; re-check the Activation Session (not revoked, < 15 min), eligibility;
   - `UPDATE iam_credentials SET password_hash, password_changed_at = now, must_change_password = false,
     failed_attempt_count = 0, locked_until = NULL, updated_at = <version bump> WHERE must_change_password = true`
     — exactly one row, otherwise a concurrent change won (`401 SESSION_INVALID`, audit `CONCURRENT_CHANGE`);
   - `PROVISIONED` → `ACTIVE`, `activated_at = now` (AD-2 L1);
   - revoke **all** sessions of the account, including the current Activation Session (V1);
   - re-read `password_hash` after the locks; it must still equal the hash used for the `SAME_AS_CURRENT` check
     (DECIDED — guards against a concurrent change; otherwise `401 SESSION_INVALID`,
     audit `CONCURRENT_CHANGE`);
   - audit `CHANGE_PASSWORD/SUCCESS` and, when activated, `ACCOUNT_ACTIVATED/SUCCESS`; commit;
   - `40P01` / `40001`: retry once while the Activation Session is still valid; retry failed → `503 SERVICE_BUSY`, no
     change, session kept, audit `CHANGE_PASSWORD / FAILURE / TRANSIENT_DB_ERROR`.
6. Response `200 { "status": "PASSWORD_CHANGED_RELOGIN" }` and clear the cookie. **No Authenticated Session is issued:
   the user must log in again with the new password (D-B1-1).**

### 5.3 Password policy (DECIDED AD-6 / P-4)

| Rule | Status | `details.reason` |
|---|---|---|
| NFC normalisation before every check and before hashing; no trimming | DECIDED | — |
| ≥ 15 Unicode code points | DECIDED | `TOO_SHORT` |
| ≤ 128 code points | DECIDED | `TOO_LONG` |
| ≤ 512 UTF-8 bytes | DECIDED | `TOO_LONG_BYTES` |
| No composition rules | DECIDED | — |
| No C0 (U+0000–U+001F), DEL (U+007F) or C1 (U+0080–U+009F) control character | DECIDED (P-4c) | `CONTROL_CHARACTERS` |
| Whole-password, **case-insensitive** match against the offline blocklist (never substrings) | DECIDED (P-4d); source, size, update process PENDING (P-4a/b) | `BLOCKLISTED` |
| Whole-password, **case-insensitive** contextual checks (username, employee code, name variants, brand names + fixed suffixes) | DECIDED (P-4d) | `CONTEXT_MATCH` |
| Must differ from the current password — checked by Argon2id verify of the NFC new password against the current `password_hash`; no plaintext of the old password is stored, kept or logged | DECIDED | `SAME_AS_CURRENT` |

`SAME_AS_CURRENT` does not conflict with the Security Contract: the "exactly one Argon2id verification per request"
rule (P-5) applies to login; first-change is called by an authenticated Activation Session, is rate-limited, and adds
one verify plus one hash. The check compares only with the current hash (no password history in Phase B).

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
| Retry limit | exactly one retry of the database transaction; no loop, no Argon2 repeat, no extra reservation |
| After the retry fails (or D / the Activation Session no longer allows a retry) | login and first-change → `503 SERVICE_BUSY` (DECIDED), audit `FAILURE / TRANSIENT_DB_ERROR`; **never `401`**. Account-distinguishability: §4.5 |
| Other database errors | `500 INTERNAL_ERROR` (no retry); during login subject to IB-1 (§4.5). Logout / session have no retry: database error → `500` |
| Retry path | implemented in the SC5 prototype, **not yet triggered by a test** — PENDING (contract tests CT-R1..R4) |
| Guarantees | INV-1…INV-9 verified on PostgreSQL (SC5-V1); **G3/G4 not guaranteed** (published); INV-10 **NOT VERIFIED** (needs the API; blockers IB-1..IB-3) |

## 10. Argon2id (DECIDED P-6a; local baseline DECIDED; production values PENDING)

- Library `@node-rs/argon2`, algorithm **Argon2id declared explicitly**, PHC strings; no own encoder/decoder.
- **Local development baseline (DECIDED): `m = 19 MiB` (19456 KiB), `t = 2`, `p = 1`.** This is a baseline, not a
  production benchmark result.
- **PENDING (P-6b production):** production parameters, maximum concurrent hash/verify operations, p95 target and queue
  timeout (→ `503 SERVICE_BUSY`), chosen by benchmark on the deployment hardware.
- The dummy hash always uses the same parameters as real hashes. No pepper in Phase B. Re-hashing on parameter change
  is not part of Phase B.

## 11. Audit (DECIDED structure, P-8)

All audit rows are written by `talo_app` with `INSERT` **without `RETURNING`**, in the same transaction as the state
change. Never logged or stored: passwords, tokens, hashes, a username that did not match an account, request bodies.

| `action_code` | `outcome` | `reason` (closed set) |
|---|---|---|
| `LOGIN` | `FAILURE` | `UNKNOWN_USERNAME`, `NO_CREDENTIAL`, `BAD_PASSWORD`, `LOCK_TRIGGERED` (failed slot 5), `CREDENTIAL_CHANGED`, `ATTEMPT_EXPIRED`, `TRANSIENT_DB_ERROR` |
| `LOGIN` | `DENIED` | `TEMP_LOCKED`, `ACCOUNT_DISABLED`, `ACCOUNT_LOCKED`, `MEMBERSHIP_EXITED`, `MEMBERSHIP_LEFT_DATE_PASSED` |
| `LOGIN` | `SUCCESS` | `OK`, `PASSWORD_CHANGE_REQUIRED` |
| `CHANGE_PASSWORD` | `SUCCESS` / `FAILURE` / `DENIED` | `OK` / `POLICY_VIOLATION` (+ `policy` = §5.3 reason), `TRANSIENT_DB_ERROR` / `SESSION_INVALID`, `CONCURRENT_CHANGE`, `ACCOUNT_NOT_ALLOWED` |
| `ACCOUNT_ACTIVATED` | `SUCCESS` | `OK` |
| `LOGOUT` | `SUCCESS` | `OK` |
| `SESSION_INVALIDATED` | `DENIED` | `SESSION_EXPIRED`, `SESSION_IDLE`, `ACTIVATION_EXPIRED`, `ACTIVATION_INVARIANT_VIOLATION`, `ELIGIBILITY_LOST` |

Columns: `actor_account_id` = NULL for unauthenticated failures, the account for authenticated actions;
`target_type` = `USER_ACCOUNT` or `SESSION`; `target_id` = account (NULL for an unknown username); `session_id` when
known; `occurred_at` = DB time. `metadata` (versioned, built by one function only):
`{ "v": 1, "reason": "…", "requestId": "…", "ip": "…", "ua": "…", "slot"?: n, "policy"?: "…" }` (DECIDED, P-8):

- `reason` from the closed set above; `requestId` = the response's `X-Request-Id`;
- `ip` = client address as resolved by Express under the `TRUST_PROXY` setting (§2), `ua` = `User-Agent` header;
  both truncated to **256 characters**;
- no other keys. Production retention **PENDING (P-8)**.

`TRANSIENT_DB_ERROR` rows (DECIDED) are written by a separate autocommit `INSERT` after the failed transaction was
rolled back. Error policy for that INSERT (DECIDED at AUTH-B1.2/B1.3 acceptance): one attempt, no retry; if it fails, the response is still `503` and only a
structured log line is written (`requestId`, action, reason, SQLSTATE). Neither the audit row nor the log line ever
contains a password, token, hash, attempted username, SQL text or driver message.

## 12. Contract test matrix (to be implemented with the API; DB tests on `talo_mos_v4_test`)

| ID | Area | Case | Expected |
|---|---|---|---|
| CT-L1 | login | active account, correct password | 200 AUTHENTICATED, cookie flags exact (HttpOnly, SameSite=Strict, Path=/, no Max-Age/Expires; Secure in production config) |
| CT-L2 | login | provisioned account | 200 PASSWORD_CHANGE_REQUIRED, activation cookie, `expiresAt - serverTime = 15 min` |
| CT-L3 | INV-10 | unknown user / wrong password / slot-5 failure / locked / no credential / credential changed / attempt expired / stale-locked | after replacing `requestId` and `X-Request-Id` by a placeholder: identical status, header set and values, byte-identical body; each `requestId` a fresh UUID v4 equal to `X-Request-Id`; one Argon2 call each (spy); timing distribution per branch measured and reported (IB-2) |
| CT-L10 | INV-10 / IB-1 | injected non-retryable DB error at lookup, RESERVE and FAILURE audit, for an existing and an unknown username | same status, headers and body (after normalisation) for existing and unknown usernames |
| CT-L4 | AD-5 | 5 wrong → lock 15 min; 6th refused; correct 5th logs in | as SC5 A1–A4, through HTTP |
| CT-L5 | AD-3 | EXITED / left_at today / LOCKED / DISABLED with the correct password | 403 ACCOUNT_NOT_ALLOWED; wrong password → uniform 401 |
| CT-L6 | input | over-long password, wrong types, missing fields, C0, DEL or C1 character in the password | 400 VALIDATION_ERROR before any DB access |
| CT-L7 | rate limit | 61st login request from one IP within 15 min (local config) | 429 before validation and Argon2 (spy: 0 calls); another IP unaffected |
| CT-F1 | first-change | valid change | 200 PASSWORD_CHANGED_RELOGIN, cookie cleared, all sessions revoked, account ACTIVE, old password rejected, new password logs in |
| CT-F2 | policy | each §5.3 reason, including `SAME_AS_CURRENT` (new = temporary password, also after NFC) and case variants of blocklist/contextual entries | 400 PASSWORD_POLICY with `details.reason`; no blocklist entry disclosed; no plaintext in DB or logs |
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
| CT-A1 | audit | every branch | expected action/outcome/reason; metadata keys ⊆ `{v, reason, requestId, ip, ua, slot, policy}`; `ip`/`ua` ≤ 256 characters (test with a 300-character `User-Agent`); no password/token/hash/attempted username anywhere (DB + logs) |
| CT-L8 | lockout concurrency | 10 parallel logins with wrong passwords; 4 wrong + 1 correct in parallel (many rounds) | exactly 5 Argon2 verifications with the real hash per cycle, one lock; no session while locked (SC5 A8/A10 through HTTP) |
| CT-L9 | stale / deadline | stale SUCCESS after a new locked cycle; SUCCESS 31 s after RESERVE | uniform 401, no reset, counter/lock/version unchanged |
| CT-R1 | retry | injected `40P01` once in SUCCESS | one retry, success |
| CT-R2 | retry | injected `40P01` twice in SUCCESS / retry beyond D | `503 SERVICE_BUSY` (never 401); no session, no reset, one RESERVE and one Argon2 call only; audit `TRANSIENT_DB_ERROR` |
| CT-R3 | retry | injected `40001` once in first-change | one retry; exactly one password change |
| CT-R4 | retry | injected `40001` twice in first-change | `503 SERVICE_BUSY`; password, account status and sessions unchanged; audit `TRANSIENT_DB_ERROR` |
| CT-T1 | DB time | application clock skewed (fake timers) | no effect on lock, expiry or deadline decisions |
| CT-P1 | privileges | whole suite as `talo_app` | no grant change needed |
| CT-C1 | client storage | browser test after login, logout and first-change | no token/session id/password in `localStorage`/`sessionStorage`; username key present only when the checkbox was checked |

## 13. Status of parameters

### 13.1 Decided (used as-is by this contract)

| Item | Decision |
|---|---|
| AD-3, AD-4, AD-5, AD-6, P-1, P-4 (length, NFC, no trim, no composition), P-5, P-6a, SC-5 H-b, D = 30 s, writer protocol, D-B1-2, D-UI-1/2 | as written in this document |
| AD-1 / D-B1-1 | a successful first change issues no Authenticated Session; the user must log in again |
| P-4c | C0 (U+0000–U+001F), DEL (U+007F) and C1 (U+0080–U+009F) rejected — login `400 VALIDATION_ERROR`, first-change `PASSWORD_POLICY / CONTROL_CHARACTERS` |
| P-4d | whole-password, case-insensitive blocklist match and contextual checks |
| `SAME_AS_CURRENT` | new password must differ from the current one; checked by Argon2id verify against the current hash; no plaintext stored |
| P-6 (local) | Argon2id `m = 19 MiB, t = 2, p = 1` (local baseline, not a production benchmark) |
| P-7 (local) | login: 60 requests / 15 min / IP, evaluated before validation and any Argon2 work, `429 RATE_LIMITED` |
| P-8 | audit: closed reason codes, `requestId`, `ip`, `ua` (each ≤ 256 characters), versioned metadata from one builder, no secrets, INSERT without RETURNING |
| P-10 | provisioning database role `talo_provisioner` (created and verified in AUTH-DB-F2; no endpoint in this API) |
| INV-10 `requestId` | differing `requestId` between `INVALID_CREDENTIALS` responses accepted; tests normalise it; envelope unchanged |
| Retry exhaustion | one retry on `40P01` / `40001`, then `503 SERVICE_BUSY` (login and first-change), never `401` |
| Hash-queue `503` after RESERVE | the reserved slot is not refunded; no extra reservation |
| First-change concurrency | `password_hash` re-checked inside the transaction after the locks |
| `TRANSIENT_DB_ERROR` audit | separate INSERT after rollback, one attempt, no retry; on failure still `503` plus one minimal structured log (`requestId`, action, reason, SQLSTATE); never secrets, SQL text or driver error (§11) |
| OpenAPI `info.license` | not added (decision AUTH-B1.1 acceptance) |

### 13.2 PENDING (not decided or not verifiable yet — not invented here)

| Item | Why pending / concrete scope |
|---|---|
| P-4a/b blocklist | source, licence, size, update process |
| P-4e temporary password issued by IT | the provisioning sources (Spec v0.2, IAM SQL comments, Handoff §4) only fix: IT issues it, only the Argon2id hash is stored, `must_change_password = true`. Not decided: generation (length, character set, randomness source), whether the PW3 limits apply to it, delivery channel to the employee, expiry of an unused temporary password |
| P-6b production | Argon2id production parameters, concurrency limit, p95 target, queue timeout — benchmark on deployment hardware |
| P-7 beyond local login | production thresholds; threshold for `POST /api/auth/password/first-change` |
| P-8 retention | production audit retention |
| INV-10 | **NOT VERIFIED** — needs the API; implementation blockers IB-1 (account-independent error paths before proof of the password), IB-2 (timing), IB-3 (global hash queue), §4.5 |
| Retry paths | CT-R1..R4 — verifiable only once the API exists |
| P-11 | Vietnamese messages — AUTH-B1.3 |
