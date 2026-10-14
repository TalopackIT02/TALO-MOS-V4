# AUTH-SC5-V1 — Authentication concurrency & lockout verification

> **Update (DB integration):** the user approved H-b, D = 30 s, the mandatory writer protocol and the
> `talo_test_harness` role. PostgreSQL integration results are in `backend/test/integration/sc5/README.md`;
> model results below remain model evidence only.

**Status: design + static/model verification only.** No authentication code, no session issuance, no database
writes. Files here: `sc5Model.ts` (executable model), `sc5Model.test.ts` (exhaustive interleaving tests, part of
`npm test`), `sc5-protocol.sql` (SQL prototypes, privilege-checked with `EXPLAIN` only).

## 1. Sources and what is (not) approved

| Item | Source | Status |
|---|---|---|
| AD-3, AD-4, AD-5, AD-6, P-1, P-4, P-5, P-6a | Phase B0 decisions (user-approved, conversation) | DECIDED |
| F2-04, F2-05, F2-07, F2-07b, F2-08 | AUTH-DB-F2 review/acceptance | tracked; F2-07b decided ("database time is the source") |
| G1–G4, AS-1, T5-1…T5-14, TA-1…TA-6, SC-5 "option D" | B0 drafts (Candidate, revisions) in the conversation | **RECOMMENDED only — not in any repository document, never approved as such.** Restated below so they can be reviewed. |
| H-a, H-b, writer protocol, attempt deadline D, invariants INV-* | this document | **PROPOSED** |

## 2. Invariants

| ID | Invariant | Origin | Verified by |
|---|---|---|---|
| INV-1 (G1) | In one lockout cycle at most N (=5) real password verifications happen | AD-5 | model (all interleavings), integration T5-2 |
| INV-2 | `c ≤ N`, and `c = N ⇒ locked_until` is set | AD-5 | model |
| INV-3 | The N-th attempt, if correct, logs in and is not counted as a failure | AD-5 constraint | model T5-4, integration T5-4 |
| INV-4 | A request that reserved in an older cycle never resets the counter nor clears a lock of a newer cycle | AD-5 constraint | model (negative control "naive" violates it), integration T5-11/12 |
| INV-5 | Locked / unreserved requests never verify the real hash (dummy Argon2 only) | P-5 | model T5-1, integration T5-1 |
| INV-6 | No session is issued while the credential is locked, except to the request whose own reservation set the lock | AD-5 | model |
| INV-7 (AD-3) | After a committed eligibility invalidation (membership EXITED / left_at passed / account LOCKED/DISABLED) no live session remains and none is issued later; every request re-checks eligibility on DB time | AD-3 | model (+ two negative controls), integration TA-7/TA-8 |
| INV-8 (AS-1) | At most one live activation session per account | P-1 | model, integration TA-1 |
| INV-9 | Every security time (lock, expiry, idle, left_at date) comes from PostgreSQL | F2-07b | SQL review, integration T5-10 |
| INV-10 | Unauthenticated failures are indistinguishable (status, body, headers, one Argon2 each) | P-5 | auth implementation tests (out of SC5-V1) |

Not achievable with the current schema (published, unchanged): G3 (≤ N verifications running *simultaneously*) and
G4 (≤ N per *any* 15-minute window when legitimate logins interleave) — every successful login legitimately opens a new
cycle.

## 3. Credential state machine (H-b, recommended)

State per credential row: `c = failed_attempt_count`, `L = locked_until`, `v = updated_at` (version), all on DB time `t`.

| State | Condition |
|---|---|
| OPEN | `L IS NULL` and `c < N` |
| LOCKED | `L > t` |
| EXPIRED | `L ≤ t` (treated as OPEN; restarted lazily by the next RESERVE) |

| Transition | When | Effect (one atomic statement / one transaction) |
|---|---|---|
| RESERVE | OPEN, `c < N` | `c += 1`; if `c = N` then `L = t + 15 min`; `v++`; returns `slot, v, L, password_hash, reserved_at` |
| RESERVE (restart) | EXPIRED | `c = 1`, `L = NULL` (new cycle); `v++` |
| RESERVE (refused) | LOCKED | no write; caller runs a dummy verify and answers the uniform 401 |
| FAILURE | verify false | **no credential write** (the attempt was counted at RESERVE); audit only |
| SUCCESS-CAS | verify true, under account+credential locks, `v_now = v_reserved` | `c = 0`, `L = NULL`, `v++` (new cycle) |
| SUCCESS-no-reset | verify true, `v_now ≠ v_reserved` | no counter change; session only if not LOCKED now |
| PASSWORD CHANGE | first-change / future admin reset | new hash, `c = 0`, `L = NULL`, `v++` |

Every writer of `iam_credentials` must bump `v` with `GREATEST(statement_timestamp(), updated_at + 1 µs)` — this is the
only contract on the column; its meaning ("time of the last update") is preserved.

## 4. Options compared

| | H-a — cycle anchor | **H-b — version CAS (recommended)** | H-c — lock held during Argon2 | H-d — SERIALIZABLE everywhere |
|---|---|---|---|---|
| Idea | `updated_at` changes only when a cycle starts; SUCCESS resets iff the anchor is unchanged | `updated_at` strictly increases on every credential write; SUCCESS resets iff no write happened since its reservation | `FOR UPDATE` on credential across verify | SSI detects conflicting reads/writes |
| Linearization point | RESERVE statement; SUCCESS at lock acquisition | same | the locked transaction | commit |
| Isolation | READ COMMITTED | READ COMMITTED | READ COMMITTED | SERIALIZABLE (+ retries) |
| Lock order | account → credential → sessions | account → credential → sessions | credential (long) | n/a |
| Stale SUCCESS (INV-4) | safe (anchor changes at every new cycle) | safe (any new cycle is a write ⇒ version differs; strictly monotonic ⇒ no ABA) | safe | safe only if *every* writer is SERIALIZABLE |
| 5th attempt correct | resets | resets (no write after its own reservation; refused RESERVEs do not write) | resets | resets |
| Correct login with a later same-cycle reservation | resets whole cycle, clears that lock | logs in if not locked, **does not reset** (its slot stays counted); refused if a later reservation locked | n/a (serialised) | resets |
| Column semantics | **changes `updated_at` meaning** (no longer "last update") — needs approval | unchanged | unchanged | unchanged |
| Cost | as H-b | one extra row write per attempt | connection + row lock held 50–300 ms per attempt → pool exhaustion / DoS amplification | retries (40001), requires all writers to cooperate |
| Privileges | existing grants | existing grants | existing grants | existing grants |

Retry: H-a/H-b have no serialization failures by design (single-statement RESERVE, consistent lock order). An
unexpected `40P01`/`40001` in SUCCESS is retried **once** while still inside the attempt deadline D; otherwise the
uniform 401 is returned and nothing is reset.

Attempt deadline D (proposed 30 s, PENDING): SUCCESS refuses (401, no reset) when
`statement_timestamp() − reserved_at > D`. With D < T (15 min) a request can never survive into a cycle that started
because a lock *expired*; cycles started by another successful login are handled by the CAS.

## 5. Proof sketch (H-b)

1. *Monotonic version.* Every credential write sets `v' = max(t, v + 1µs) > v`; writes to one row are serialised by
   the row lock, so versions are strictly increasing. No value repeats (no ABA).
2. *INV-4.* A new cycle starts only through a write (CAS reset, restart, password change). A request R that reserved
   with version `v_R` performs a reset only when `v_now = v_R`, i.e. no write happened since R's own RESERVE — R is still
   in its own cycle. Hence a stale R can never reset/unlock a newer cycle.
3. *INV-1.* RESERVE is one atomic UPDATE whose WHERE clause grants a slot only if `c < N` (or the lock expired); each
   real verification needs a granted slot; within a cycle `c` only increases ⇒ ≤ N real verifications.
4. *INV-3.* The N-th RESERVE sets `L` and `v_N`. Refused RESERVEs do not write, so `v_now = v_N` at its SUCCESS ⇒ reset.
5. *INV-6.* After the (possible) reset SUCCESS checks `locked_now` under the credential lock; only the holder of the
   locking slot can have unlocked it.
6. *INV-7.* SUCCESS holds `FOR NO KEY UPDATE` on the account row and then reads eligibility in a new statement
   (READ COMMITTED ⇒ fresh snapshot after the lock). Any eligibility writer must take the same account-row lock, write,
   and revoke sessions in one transaction. Either the writer commits first (SUCCESS waits, then reads the new state and
   refuses) or SUCCESS commits first (the writer waits, then its revoke statement sees and revokes the new session).
   Time-based invalidation (`left_at` reached) needs no writer: every request validates on `statement_timestamp()`.
7. *INV-8.* Activation SUCCESS revokes all live sessions of the account and inserts the new one while holding the
   account lock; concurrent activation logins serialise on that lock. Winner = last lock holder, independent of
   `created_at` (which is never used to choose).

## 6. AD-3 / F2-04 analysis

`talo_app` cannot lock `iam_memberships` (needs an UPDATE privilege — PostgreSQL docs; confirmed by `EXPLAIN`).
Re-reading the membership alone is **not** a concurrency guarantee: a membership writer that commits between the read
and the session insert would leave a fresh session behind. The proposal closes this with **lock coupling on the
account row**, which `talo_app` may lock (it has UPDATE on `account_status`, `activated_at`):

| Race | Outcome with lock coupling + writer protocol |
|---|---|
| Membership → EXITED during login | serialised on the account row: login refused, or its session revoked by the writer |
| `left_at` set/changed by a writer | same as above when the new value makes the account ineligible |
| `left_at` reached by time passing | next request refused (VALIDATE_SESSION on DB date, Asia/Ho_Chi_Minh) |
| Account LOCKED / DISABLED | writer locks the account row (it is the row being changed) ⇒ serialised |
| Credential changed / locked during login | SUCCESS re-reads under the credential lock: hash differs ⇒ 401; locked ⇒ 401 |
| Session validation vs membership change | a request is linearised at its VALIDATE_SESSION read; the writer revokes all sessions, so every later request is refused |

Isolation: READ COMMITTED is required for this protocol (each statement after a lock wait sees committed data;
`FOR NO KEY UPDATE` re-evaluates the row). REPEATABLE READ would read a stale snapshot after waiting and raise
`40001` on locked-row updates; SERIALIZABLE only protects if the membership writer is also SERIALIZABLE.

**Limitation (requires a decision):** the guarantee depends on the writer protocol. Writers do not exist yet (HR sync,
IAM management, manual SQL). A writer that skips the account lock or the revoke degrades INV-7 to "refused at the next
request". Two negative controls in the model demonstrate both failure modes.

## 7. Database time

| Value | Expression |
|---|---|
| decision time inside a statement | `statement_timestamp()` (stable per statement; taken after any earlier lock wait in the same transaction) |
| lock | `locked_until = statement_timestamp() + interval '15 minutes'` (in RESERVE) |
| session | `created_at = statement_timestamp()`, `expires_at = created_at + interval '10 hours'` (activation: `15 minutes`), `last_seen_at = created_at` |
| idle | `last_seen_at > statement_timestamp() - interval '60 minutes'` |
| business date | `(statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date` compared with `left_at` |
| attempt deadline | `statement_timestamp() - reserved_at <= D` in the SUCCESS transaction, after the locks |

`now()` (transaction start) is avoided inside SUCCESS because the transaction may wait for locks. RESERVE uses the
statement time of a single statement; if it waited on the row lock, expiry is evaluated slightly early (conservative).
Session inserts are raw SQL: Prisma `create` would send `created_at` from the application clock (F2-07b).

## 8. Interleavings (illustrative; the model explores all of them)

```text
Stale SUCCESS — naive (B0 draft D) vs H-b                     N=5
 R0(correct) RESERVE slot1 v1 ─┐
 R1(correct) RESERVE slot2 v2  │
 R1 SUCCESS: v2=v2 → reset (cycle 2, v3)
 W1..W5 RESERVE slots 1..5 → L set (v4..v8)
 R0 SUCCESS: naive → resets c, clears L  ✗ INV-4      H-b: v8≠v1 → no reset; locked → 401  ✓

Membership exit vs login (lock coupling)
 order A: WRITER locks account → EXITED → revoke → COMMIT;  SUCCESS waits → reads EXITED → 403
 order B: SUCCESS locks account → eligible → insert session → COMMIT;  WRITER waits → EXITED → revokes it
 without coupling: SUCCESS reads ACTIVE … WRITER commits … SUCCESS inserts → live session for EXITED ✗ (model)
```

## 9. Test matrix

| ID | Scenario | Expected | Model | DB integration (planned) |
|---|---|---|---|---|
| T5-1 | 5 wrong sequential, 6th correct | lock at 5th; 6th refused, no real verify | ✔ | ✔ |
| T5-2 | 2N concurrent wrong | exactly N reservations, one lock | ✔ (N=2/3 exhaustive) | ✔ (10 parallel connections) |
| T5-3 | N−1 wrong + 1 correct concurrently | correct logs in; counter state per H-b rules | ✔ | ✔ |
| T5-4 | 4 wrong then correct 5th | login, c=0, L=NULL | ✔ | ✔ |
| T5-5 | lock expired | next RESERVE slot 1 (new cycle) | ✔ | ✔ (harness sets `locked_until` in the past) |
| T5-6 | crash after RESERVE | slot consumed, no session, no audit | (by construction) | ✔ (abort between steps) |
| T5-8 | password changed between RESERVE and SUCCESS | 401 CREDENTIAL_CHANGED | ✔ | ✔ |
| T5-9 | account disabled between RESERVE and SUCCESS | 403, no session | ✔ (writer) | ✔ |
| T5-10 | boundary `locked_until = now` | expired | SQL review | ✔ |
| T5-11 | stale SUCCESS after a new cycle was locked | no reset, 401 | ✔ (+ naive negative control) | ✔ |
| T5-12 | old-cycle FAILURE after reset | no credential write | ✔ | ✔ |
| T5-13 | attempt exceeds deadline D | 401, no reset | ✔ | ✔ |
| TA-1 | 2/10 concurrent activation logins | one live activation session | ✔ | ✔ |
| TA-4 | activation login vs first-change | 401 CREDENTIAL_CHANGED | ✔ (hash change) | ✔ |
| TA-5 | touch on revoked session | 0 rows | SQL (`revoked_at IS NULL`) | ✔ |
| TA-7 | membership EXITED during login (both orders) | no live session afterwards | ✔ | ✔ |
| TA-8 | session use after EXITED | refused | SQL (VALIDATE_SESSION) | ✔ |

## 10. Privilege compatibility (talo_app, verified with EXPLAIN in READ ONLY transactions)

| Statement | Needs | Result |
|---|---|---|
| RESERVE / HA_RESERVE | SELECT + UPDATE(failed_attempt_count, locked_until, updated_at) on credentials; RETURNING password_hash | ALLOW |
| SUCCESS_LOCK_ACCOUNT | SELECT + ≥1 UPDATE column on accounts (`FOR NO KEY UPDATE`) | ALLOW |
| SUCCESS_LOCK_CREDENTIAL | same on credentials | ALLOW |
| SUCCESS_READ_ELIGIBILITY | SELECT memberships/accounts/credentials | ALLOW |
| SUCCESS_CAS_RESET, FIRST_CHANGE_CREDENTIAL | UPDATE granted credential columns | ALLOW |
| FIRST_CHANGE_ACTIVATE | UPDATE(account_status, activated_at) | ALLOW |
| SUCCESS_REVOKE_OTHER_SESSIONS, TOUCH_SESSION, LOGOUT | UPDATE(revoked_at / last_seen_at) | ALLOW |
| SUCCESS_INSERT_SESSION (RETURNING) | INSERT + SELECT sessions | ALLOW |
| AUDIT_INSERT (no RETURNING) | INSERT audit | ALLOW |
| VALIDATE_SESSION | SELECT sessions/accounts/credentials/memberships | ALLOW |
| lock membership `FOR UPDATE` / `FOR KEY SHARE` | UPDATE on memberships | **DENY** (F2-04) |
| audit INSERT … RETURNING | SELECT audit | **DENY** (F2-07) |
| UPDATE accounts.disabled_at, UPDATE memberships | not granted | **DENY** (writers must be privileged) |

No new GRANT is needed for H-b (or H-a). The writer protocol runs under a privileged role that does not exist yet.

## 11. DB integration test plan (approval checkpoint — nothing executed)

- **Target:** `talo_mos_v4_test` only; every script/test asserts `current_database() = 'talo_mos_v4_test'`.
- **Roles:** protocol steps run as `talo_app` (real grants). Fixture setup/cleanup and simulated writers need
  INSERT/DELETE on memberships/accounts/credentials/sessions/audit, which no application role has. Options:
  **(A)** `admin` used only by the test harness on the test DB; **(B)** a new `talo_test_harness` role (LOGIN,
  NOSUPERUSER; SELECT/INSERT/UPDATE/DELETE on the 5 tables, test DB only) — needs CREATE ROLE + GRANT approval.
- **Dataset (per run, tagged `employee_code LIKE 'SC5T-%'`):** M1 ACTIVE + A1 ACTIVE + C1 (c=0); M2 ACTIVE + A2 ACTIVE
  (for the exit race); M3 ACTIVE + A3 PROVISIONED (must_change) for activation tests. Credential hashes are placeholders:
  the protocol tests decide "correct/wrong" in the harness; Argon2 is not under test here.
- **Setup SQL:** `INSERT` memberships (random `employee_id`), accounts, credentials — harness role.
- **Isolation:** concurrency tests need real commits across connections, so no outer rollback; each test re-creates its
  rows and the cleanup deletes by tag in FK order: audit → sessions → credentials → accounts → memberships.
- **Before/after checks:** all IAM row counts in the test DB = 0 before and after; schema dump of the test DB
  unchanged; dev snapshot (catalog, counts, ACL) unchanged.
- **Failure mid-way:** cleanup runs in `finally` and again at the start of the next run (idempotent, by tag); if cleanup
  fails the suite stops and reports the remaining rows; nothing outside the tag is ever deleted.

## 12. Decisions requested

1. Protocol: **H-b** (recommended) or H-a (requires changing the meaning of `iam_credentials.updated_at`).
2. Attempt deadline D (proposal 30 s; must be < 15 min).
3. Writer protocol for eligibility changes (account-row lock + revoke in the same transaction) as a binding rule for all
   future writers — or accept the weaker "refused at next request" guarantee.
4. Test harness role: (A) admin on the test DB only, or (B) new `talo_test_harness` role (CREATE ROLE + GRANT).
5. Approval to write fixture data into `talo_mos_v4_test` for the integration tests of §9/§11.
