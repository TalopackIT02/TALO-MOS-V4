# F2-DB-GATE2 — FINAL GATE 2 REVIEW REPORT (REVISION-01, updated by REVISION-02)

> **REVISION-02 (owner CHECK approval) is recorded in §12 at the end of this report.** Sections 1–11 are the REVISION-01 report and are kept as history. Where they say "23 pending CHECKs" or "CHECK active 11", §12 gives the current state: 32 active, 2 pending.

| Item | Value |
|---|---|
| Task | F2-DB-GATE2-REVISION-01: Foundation Database DDL review revision |
| Baseline | Foundation Database Design Baseline v1.0, DESIGN LOCKED (16/10/2026), 14 tables / 125 columns |
| Owner decisions applied | Q01–Q08 (OWNER APPROVED). SQL execution **NOT approved** |
| Gate status | GATE 1 COMPLETED · **GATE 2 DDL Draft & Review: complete, awaiting owner approval** · GATE 3 / GATE 4 not started |
| Git HEAD | `4508cbb` (branch `main`; owner commit of the 3 baseline/prompt documents during this task, SHA-256 unchanged) |
| Database | **Not accessed** in this task (no connection, no SQL) |

**Sources read:**
- `documents/development/`: Baseline v1.0 `.docx` and `_FOR_CLAUDE.md`, and `TASK-F2-DB-GATE2-ClaudeCode-Prompt.md`. SHA-256 of each file:
  - FOR_CLAUDE.md `cefa7039…c8df05bd2`
  - docx `4f2d30fa…b08518c8a8`
  - task prompt `ee3ea55a…fb1a`
- `CLAUDE.md`, Governance v0.1 (DRAFT, reference only), F2 Vibecoding v0.1.
- `database/sql/TALO-MOS-IAM-Security-PostgreSQL-v0.3.sql`, `database/prisma/schema.prisma`.
- The Gate 2 report and the Gate 2 DDL draft of the previous task.

## 1. Q01–Q08: what was applied

| Decision | Applied in the draft | Not applied / remains outside the DDL |
|---|---|---|
| **Q01** one ACTIVE per Module | Active partial UNIQUE index `uq_fnd_module_versions_one_active (module_id) WHERE status = 'ACTIVE'`. Retire-before-activate order documented (§3) | Index not executed. Transaction ordering is BACKEND |
| **Q02** same Module | Active: 2 supporting UNIQUE (B02 `(version_id, module_id)`, B03 `(function_id, module_id)`) and 6 composite FKs (B03 replaces, B07, B08, B09, B13 from/to). All columns exist in the 125 | "B08 version ⇒ module" and "B09 function ⇒ module" need CHECKs N-01/N-02 (PENDING). B05, B06 and B12 have no column for a FK: **BACKEND REQUIRED** |
| **Q03** RFC 8785 / SHA-256 lowercase hex / identifiers | Identifier rule written as D-01…D-03 (revised regex). Hash format written as N-03…N-07. All PENDING | Hash **content** check (RFC 8785 + SHA-256) = BACKEND. No hash column or DB hash function added. IAM matching on normalised codes = BACKEND; IAM unchanged |
| **Q04** lifecycle | State Transition Matrix (§3). D-06 revised to the approved lifecycle. D-04 and D-05 confirmed consistent | Transitions cannot be checked by CHECK (no access to the old value): BACKEND. B02 columns unchanged |
| **Q05** value lists | N-08 event_type (9), N-09 resolution_status (2), N-10 change_area (10, replaces A-12). `BLOCK` (B13 result) and `BLOCKING` (B14 severity) kept as distinct [A] values | `action_code` list not approved: no CHECK (BLOCKED) |
| **Q06** missing data rules | N-11 DIRECT_DB target, N-12 enabled ⇒ approval mode, N-13 completed ≥ started, N-14 references_target. All PENDING | Cycles of length ≥ 2 (B03, B09) = BACKEND. No trigger or procedure. Data Contract tables unchanged |
| **Q07** history and rights | 29/29 FKs `ON DELETE RESTRICT`. `fnd_audit_logs.event_id` documented as an anti-duplicate key, not an FK. Enforcement split into constraint / privilege / backend (Coverage §6) | No role, GRANT, REVOKE or trigger created. Audit append-only and K04 lock depend on Gate 3 privileges plus BACKEND |
| **Q08** gates and storage | Gate names per Q08. File naming per the task | **Storage:** `CLAUDE.md` makes `documents/` read-only (boundary 1) and limits edits to `frontend/`, `backend/`, `tests/`, `docker/` (boundary 3). Files were therefore prepared outside the repository and **wait for owner permission** (§9) |

## 2. Not allowed to deploy / not done
- Any SQL execution, migration, Prisma `migrate`/`db push`, seed, connection to dev/test (Gate 3/4).
- The 23 pending CHECK expressions (D-01…D-09, N-01…N-14) until the owner approves each one.
- Roles, schema owner (`AUTHORIZATION`), GRANT/REVOKE, column-level privileges, REVOKE of PUBLIC rights on dev.
- Triggers, functions, procedures, RLS policies, extra indexes (including indexes on FK columns).
- Changes to IAM v0.3, Auth, backend, frontend, baseline documents.

## 3. Q04: State Transition Matrix (`fnd_module_versions.status`)

Rows = current status, columns = new status. ✔ = allowed by Q04, ✖ = forbidden.

| From \ To | DRAFT | IN_REVIEW | APPROVED | ACTIVE | RETIRED | REJECTED |
|---|---|---|---|---|---|---|
| (insert) | ✔ default | ✖ | ✖ | ✖ | ✖ | ✖ |
| DRAFT | — | ✔ T1 | ✖ | ✖ | ✖ | ✖ (Q04) |
| IN_REVIEW | ✖ | — | ✔ T2 | ✖ | ✖ | ✔ T3 |
| APPROVED | ✖ | ✖ | — | ✔ T4 | ✖ | ✖ |
| ACTIVE | ✖ | ✖ | ✖ | — | ✔ T5 | ✖ |
| RETIRED | ✖ | ✖ | ✖ | ✔ T6 rollback | — | ✖ |
| REJECTED | ✖ | ✖ | ✖ | ✖ | ✖ | — (immutable, rule 09) |

| Transition | Condition | DATABASE (row state after the change) | BACKEND (transition and evidence) |
|---|---|---|---|
| T1 DRAFT → IN_REVIEW | MIC complete (MIC-01…10), RFC 8785 + SHA-256 hash | D-04 (manifest + hash present), N-03 (hash format): PENDING | completeness; hash equals content; lock MIC/B05/B06/B10/B11/B12 from now on (K04); event SUBMIT |
| T2 IN_REVIEW → APPROVED | reviewer has the IAM permission | D-05 (reviewer + time set): PENDING | permission check (code not defined: G-R05); event APPROVE |
| T3 IN_REVIEW → REJECTED | reviewer has the IAM permission | D-05: PENDING | permission check; REJECTED immutable afterwards; event REJECT |
| T4 APPROVED → ACTIVE | compatibility report, no open BLOCK, audit conformance (rules 07, 15) | **Q01 index (active)**; D-06 (activated_at set): PENDING | check B13/B14; set `activated_at` (first activation); swap transaction below; event ACTIVATE |
| T5 ACTIVE → RETIRED | done in the same transaction as the activation of the successor, or as a stand-alone retirement | D-06: PENDING | event RETIRE |
| T6 RETIRED → ACTIVE (rollback) | compatibility check of the rollback PASSED **and** approved (Q04) | **Q01 index (active)**; D-06 | keep the existing `activated_at`; record the approval and check (B13 + event ROLLBACK, see G-R13) |

**Activation / rollback transaction (BACKEND; description only, not executed).** In one transaction:
1. Lock the Module's versions.
2. Set the current ACTIVE version of the Module, if any, to `RETIRED`.
3. Set the target version (APPROVED, or RETIRED for a rollback) to `ACTIVE`, keeping `activated_at` if it is already set.
4. Write events RETIRE/ACTIVATE (or ROLLBACK) and the application audit.
5. Commit.

The Q01 index is not deferrable, so step 2 must precede step 3. Any error, including a unique violation caused by a concurrent activation, rolls back both changes (B02 rules 10 and 14).

## 4. Status of G-01 … G-18

| Gate 2 ID | Topic | Resolution | Status |
|---|---|---|---|
| G-01 | MIC canonicalisation / hash encoding | Q03: RFC 8785, SHA-256, lowercase hex | Rule RESOLVED. Format CHECKs N-03…N-07 PENDING. Content check BACKEND |
| G-02 | One ACTIVE per Module | Q01: partial unique index | **RESOLVED** (active in draft) |
| G-03 | Same Module | Q02: 2 UNIQUE + 6 composite FKs | **RESOLVED** for B03/B07/B08/B09/B13. B05/B06/B12 BACKEND REQUIRED. N-01/N-02 PENDING |
| G-04 | Cycles > 1 | Q06: backend | RESOLVED (BACKEND). D-07/D-08 (length 1) PENDING |
| G-05 | Immutability / append-only / no delete | Q07 | Principle RESOLVED. Privileges at Gate 3 (G-R08). K04 = BACKEND |
| G-06 | Value lists | Q05: event_type, resolution_status | N-08/N-09 PENDING. **action_code still BLOCKED** (G-R06) |
| G-07 | BLOCK vs BLOCKING | Q05: intentional | **RESOLVED** |
| G-08 | change_area coverage | Q05: 10 values | N-10 PENDING (replaces A-12) |
| G-09 | Lifecycle transitions | Q04 | **RESOLVED** (§3). D-04/D-05/D-06 PENDING (D-06 revised) |
| G-10 | K01 details | Q03 | Rule RESOLVED. D-01…D-03 PENDING. Scope beyond K01 open (G-R02) |
| G-11 | B08/B09 NULL combinations | Q02 | Rule RESOLVED. N-01/N-02 PENDING |
| G-12 | DIRECT_DB target | Q06 | N-11 PENDING |
| G-13 | references_target grammar | Q06: `schema.table.column` | N-14 PENDING. Exact identifier grammar open (G-R04) |
| G-14 | UNSPECIFIED + enabled; completed/started | Q06 | N-12, N-13 PENDING |
| G-15 | FK delete rule; FK indexes | Q07: RESTRICT | RESTRICT **RESOLVED**. FK-column indexes open (G-R09) |
| G-16 | B08.event_id meaning | Q07: anti-duplicate key, not FK | **RESOLVED** |
| G-17 | Gate numbering | Q08 | **RESOLVED** |
| G-18 | Target DB, owner, roles, grants, IAM approval permission | — | **OPEN**: Gate 3 (G-R08) and IAM (G-R05) |

## 5. Remaining GAPs

| ID | Gap | Affected | Minimal options (owner decides) | Impact |
|---|---|---|---|---|
| G-R01 | 23 CHECK expressions await approval | 14 tables | approve / reject / amend each ID in `F2-DB-GATE2-CHECK-D-REVIEW.md` | High |
| G-R02 | Scope of the Q03 identifier rule beyond `module_key`/`function_key`/`action_key` | `resource_key`, `data_owner_key`, `workflow_key`, `event_type`, `action_code`, `source_service`, `target_type` | (a) K01 keys only, as drafted; (b) extend to a named list (new CHECKs) | Medium |
| G-R03 | `database_fingerprint`: SHA-256? Of which metadata, canonicalised how? | B13 | confirm Q03 applies (then N-07); define the metadata scope | Low |
| G-R04 | Identifier grammar of `references_target` (case, quoting, `$`, 63-byte limit, non-physical targets) | B11 | accept the N-14 grammar or give another | Low |
| G-R05 | IAM permission code for approving/rejecting/activating Modules, and the effective-grants API | B02 transitions, B09 visibility | IAM task (IAM v0.3 unchanged) | High |
| G-R06 | `action_code` list (K07) | B08 | approve a list (then a new CHECK) or keep backend-only | Medium |
| G-R07 | Audit atomicity (transaction vs outbox), fail-closed policy per operation, retention, read access | B08 | decide before F2 backend | High |
| G-R08 | Gate 3 plan: target DB (dev/test), schema owner, runtime/provisioner roles, column-level grants, REVOKE PUBLIC on dev (DB-INSPECT-01), test plan, rollback script | all | owner Gate 3 approval | High |
| G-R09 | Indexes on FK columns are not approved (lookup and RESTRICT-check performance) | B03–B14 | approve a list at Gate 3 or defer | Low |
| G-R10 | Baseline documents do not yet record Q01–Q08 (the 10 `change_area` values, extra UNIQUE/FK/index, identifier rule) | baseline v1.0 | issue a change record / baseline revision (documents are owner-only) | Medium |
| G-R11 | Delivery location: `documents/` is read-only under `CLAUDE.md` | these 4 files | **RESOLVED 16/10/2026:** owner granted a one-time exception to create these 4 new files in `documents/development/` (no existing file modified) | — |
| G-R12 | Format of `module_version` / `contract_version` (e.g. 2.0.1) is not specified; increment rule (B02 rule 12) is BACKEND | B02 | define a format if a CHECK is wanted; none proposed | Low |
| G-R13 | Where the approval of a rollback (T6) is recorded: B02 has no rollback-approver column | B02, B07, B13 | confirm evidence = B13 PASS check + B07 `ROLLBACK` event (actor) + B08 audit; no new column | Medium |

## 6. Conflicts with the baseline
- **No conflict on tables or columns:** 14 tables / 125 columns are identical to the baseline (DOCX = MD, verified by script).
- **Owner-approved deviations to record in the baseline (G-R10):**
  - `change_area` 4 → 10 values (Q05).
  - 1 partial unique index, 2 UNIQUE and 6 FKs that the baseline does not list (Q01, Q02).
  - Identifier rule "first character is a letter" refines K01 (Q03).
- **Superseded:** CHECK A-12 (baseline 4-value `change_area`).
- **Resolved by Q08:** Vibecoding v0.1 gate names (G3/G4) are not used.

## 7. Comparison 14 tables / 125 columns
Script `compare-baseline.cjs` compared DOCX and MD field by field: 14 tables, 125 fields, 125 unique names, 0 differences in name, type, required, key/default, description or rules.

## 8. Static DDL check (script `verify-rev.cjs`, no database)

| Check | Result |
|---|---|
| 14 tables; 125 columns in baseline order; type, NOT NULL and DEFAULT equal to the baseline | **PASS** |
| Every column used by PK / UNIQUE / FK / index / pending CHECK exists in its table | **PASS** |
| 6 composite FKs reference a declared UNIQUE (the 2 Q02 superkeys) | **PASS** |
| 29/29 FKs `ON DELETE RESTRICT` | **PASS** |
| Exactly one explicit index = Q01 definition | **PASS** |
| 23 pending CHECKs present, none active in executable SQL | **PASS** |
| No GRANT/REVOKE/ALTER/DROP/TRUNCATE/INSERT/UPDATE/DELETE/function/trigger/policy/role/`iam.`/COMMIT in executable SQL | **PASS** |
| Header warning, anti-execution guard after `BEGIN`, ends with `ROLLBACK` | **PASS** |
| Negative test (a mutated copy with an activated D-01, a wrong type, an extra index, a missing superkey) | all 5 faults detected |

Totals: PK 14 · FK 29 (23 single + 6 composite) · UNIQUE 12 · CHECK active 11 · explicit index 1 · pending CHECK 23.

## 9. NOT_TESTED
- PostgreSQL syntax and execution of the draft (no parser or database allowed).
- Behaviour of every constraint and of the Q01 index, including regex semantics under `en_US.utf8` and CHAR(64) padding.
- Concurrency of the activation transaction.
- Any backend or privilege rule.

## 10. Files

Created in `documents/development/` with owner permission (G-R11). They are new files, not committed:

| # | File | Content |
|---|---|---|
| 01 | `F2-DB-GATE2-REVISED-DDL-DRAFT.sql` | DDL draft, DO NOT EXECUTE |
| 02 | `F2-DB-GATE2-CONSTRAINT-COVERAGE.md` | coverage matrix |
| 03 | `F2-DB-GATE2-CHECK-D-REVIEW.md` | 23 pending CHECKs |
| 04 | `F2-DB-GATE2-FINAL-REVIEW.md` | this report |

No other file of the repository was created, modified or deleted.

## 11. Decisions awaiting the owner
1. **G-R01:** approve, reject or amend D-01…D-09 and N-01…N-14, including the options inside N-13 (`>=`) and D-09 (blank strings).
2. **G-R02, G-R03, G-R04, G-R06:** scope of the identifier rule, fingerprint definition, references grammar, `action_code` list.
3. **G-R13:** evidence for rollback approval.
4. **G-R10:** baseline change record for Q01–Q08.
5. **Before Gate 3 (G-R05, G-R07, G-R08, G-R09):** IAM approval permission, audit atomicity policy, target DB, owner, roles, grants, FK indexes, test and rollback plans.

**Attestation:**
- No SQL, migration, Prisma command, seed, commit or push.
- No database connection.
- IAM v0.3, baseline documents, backend and frontend unchanged.
- DDL DRAFT ≠ DB ACTUAL: schema `foundation` does not exist in any database.
- **STOP AT GATE 2: awaiting owner approval.**

---

## 12. REVISION 02 — OWNER CHECK APPROVAL

| Item | Value |
|---|---|
| Task | F2-DB-GATE2-REVISION-02: final CHECK approval and DDL draft update |
| Git HEAD before this revision | `31d3fc2` (owner commit of the REVISION-01 package; its 4 files were identical to the delivered versions) |
| Write scope | One-time owner exception: update only the 4 Gate 2 files in `documents/development/` |
| Database | **Not accessed** (no connection, no SQL) |

### 12.1 CHECKs approved verbatim (19), now active constraints in the DDL draft
D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08, N-01, N-02, N-03, N-04, N-05, N-06, N-08, N-09, N-10, N-12, N-13.
- Status in the catalog: **OWNER APPROVED**.
- Expressions and constraint names are unchanged from REVISION-01 (verified by script, §12.6).

### 12.2 CHECKs approved after revision (2): **OWNER APPROVED — REVISED**
| ID | Constraint | Approved expression (replaces the REVISION-01 one) |
|---|---|---|
| D-09 | `ck_fnd_data_access_rules_workflow_when_required` | `approval_mode <> 'REQUIRED' OR (workflow_key IS NOT NULL AND btrim(workflow_key) <> '')` |
| N-11 | `ck_fnd_data_contracts_direct_db_target` | `interface_kind <> 'DIRECT_DB' OR (NULLIF(btrim(schema_name), '') IS NOT NULL AND NULLIF(btrim(table_name), '') IS NOT NULL)` |

**Recorded limit, not changed:** `btrim(x)` without a second argument removes only the space character. A value made only of tabs or line breaks therefore passes both CHECKs. Changing this would need a new owner decision.

### 12.3 Still PENDING OWNER REVIEW (2), not active
- **N-07** `database_fingerprint`:
  - The fingerprint algorithm and metadata input are not decided, so SHA-256 is not assumed.
  - The column `CHAR(64)` is unchanged.
- **N-14** `references_target`:
  - The K10 rule is kept, but the regex, quoted identifiers and letter case are not decided.
  - The column `VARCHAR(250)` is unchanged.
- Both remain only as comments in the DDL draft.

### 12.4 Totals (static analysis of the draft)
| Item | Count |
|---|---:|
| Tables / columns | **14 / 125**, unchanged; 125/125 identical to the baseline |
| PRIMARY KEY | 14 |
| FOREIGN KEY | 29 (23 single + 6 composite Q02; 29/29 `ON DELETE RESTRICT`) |
| UNIQUE constraints | 12 |
| Explicit index | 1 (Q01 partial UNIQUE index) |
| **CHECK active** | **32** = 11 [A] + 19 OWNER APPROVED + 2 OWNER APPROVED — REVISED, which equals the expected 32 |
| CHECK pending | 2 (N-07, N-14) |
| CHECK superseded | 1 (A-12) |
| Trigger / function / procedure / policy / role / GRANT | 0 |

### 12.5 GAP status after REVISION-02
Only G-R01 changed, because it is the only gap that the REVISION-02 decisions address. No other gap is marked resolved without an owner decision.

| ID | Status |
|---|---|
| G-R01 | **PARTLY RESOLVED**: 21/23 approved (19 verbatim + 2 revised); N-07 and N-14 still PENDING |
| G-R02 | OPEN: scope of the identifier rule beyond `module_key`/`function_key`/`action_key` |
| G-R03 | OPEN: fingerprint algorithm and metadata input (owner: not decided; linked to N-07) |
| G-R04 | OPEN: `references_target` grammar (owner: not decided; linked to N-14) |
| G-R05 | OPEN: IAM permission for Module approval and the effective-grants API |
| G-R06 | OPEN / BLOCKED: `action_code` list (K07) |
| G-R07 | OPEN: audit atomicity (transaction or outbox), fail-closed policy, retention, read access |
| G-R08 | OPEN: Gate 3 plan (target DB, schema owner, roles, grants, REVOKE PUBLIC on dev, tests, rollback) |
| G-R09 | OPEN: indexes on FK columns |
| G-R10 | OPEN: baseline change record for Q01–Q08 and REVISION-02 |
| G-R11 | RESOLVED (REVISION-01) |
| G-R12 | OPEN: `module_version` / `contract_version` format |
| G-R13 | OPEN: evidence of rollback approval |

### 12.6 Static checks (scripts, no database; **not** a PostgreSQL test)
| Check | Result |
|---|---|
| 14 tables; 125/125 columns equal to the baseline (name, order, type, NOT NULL, DEFAULT) | PASS |
| Constraint and index names unique (88 names) | PASS |
| The 19 approved CHECKs in the DDL have exactly the catalog expression and name | PASS |
| D-09 and N-11 in the DDL **and** in the catalog equal the owner text | PASS |
| N-07 and N-14 absent from executable SQL, present only as comments | PASS |
| 11 [A] CHECK expressions identical to REVISION-01; A-12 not active | PASS |
| PK/FK/UNIQUE/Q01-index/table definitions identical to REVISION-01 (70/70); Q01–Q08 unchanged | PASS |
| Every column used by an active CHECK exists in its table | PASS |
| Coverage matrix totals equal the DDL counts | PASS |
| No GRANT/REVOKE/ALTER/DROP/TRUNCATE/INSERT/UPDATE/DELETE/function/trigger/policy/role/`iam.`/COMMIT; warning header, `BEGIN` + `RAISE EXCEPTION` guard, ends with `ROLLBACK` | PASS |
| Negative test (a mutated copy with N-13 `>`, the old D-09, an active N-07 and a duplicate name) | all 4 faults detected |

**NOT_TESTED:** PostgreSQL syntax, execution, and the behaviour of every constraint and of the Q01 index. No `POSTGRESQL TEST PASS` is claimed.

### 12.7 Still dependent on the backend
- State transitions (Q04) and the retire-before-activate transaction.
- RFC 8785 + SHA-256 content equality of every hash.
- MIC completeness.
- K04 lock from IN_REVIEW and REJECTED immutability.
- Same-Module / same-Function / same-Version rules of B05, B06 and B12.
- Cycles of length ≥ 2 (B03, B09).
- Workflow existence and validity (D-09).
- Separate approval of DIRECT_DB (N-11).
- K11 re-check before RESOLVED.
- Audit guarantee before reporting success.
- Visibility by ACTIVE version and IAM grants.
- IAM matching on normalised codes.

### 12.8 To complete before any deployment (Gate 3 / Gate 4)
1. Owner decision on N-07 and N-14 (G-R03, G-R04).
2. Gate 3 approval of the final SQL, target database, schema owner, roles and column-level grants, tests and rollback (G-R08), plus the related decisions G-R05, G-R07, G-R09.
3. Remaining owner decisions G-R02, G-R06, G-R10, G-R12, G-R13.

### 12.9 Attestation (REVISION-02)
- **Files:** only the 4 Gate 2 files in `documents/development/` were updated. `CLAUDE.md`, baseline v1.0, IAM v0.3, backend, frontend and configuration are unchanged.
- **Database:** no SQL, migration, Prisma command or seed; no connection.
- **Structure:** 14 tables / 125 columns unchanged.
- **Git:** no commit, push or merge.
- **STOP AT GATE 2 — REVISION 02: awaiting owner approval.**
