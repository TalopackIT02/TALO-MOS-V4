# F2-DB-GATE2 — CONSTRAINT COVERAGE MATRIX (REVISION-01)

**Task:** F2-DB-GATE2-REVISION-01 · **Baseline:** Foundation Database Design v1.0 · **Decisions applied:** Q01–Q08 · **Git HEAD:** `4508cbb` (owner commit of the baseline documents; their SHA-256 is unchanged)
**Source of the counts:** static analysis of `F2-DB-GATE2-REVISED-DDL-DRAFT.sql` by script, with no database. Nothing was executed.

Categories:
- **DATABASE (ACTIVE):** guaranteed by a constraint or index that is active in the draft, either [A] from the baseline or [Q01]/[Q02] approved by the owner.
- **PENDING:** a CHECK expression awaiting owner review (D-xx, N-xx). It is not active until approved; see `F2-DB-GATE2-CHECK-D-REVIEW.md`.
- **BACKEND:** must be enforced by the trusted backend service; no declarative form exists within 14 tables / 125 columns without triggers.
- **PRIVILEGE:** needs PostgreSQL privileges (column UPDATE lists, no UPDATE/DELETE). Roles and grants are **not created**; they are decided in Gate 3.
- **BLOCKED:** a definition is missing — DECISION REQUIRED.

## 1. Totals

| Item | Gate 2 | Revision-01 | Change |
|---|---:|---:|---|
| Tables | 14 | **14** | unchanged |
| Columns | 125 | **125** | unchanged (names, types, NULL, DEFAULT identical to baseline) |
| PRIMARY KEY | 14 | **14** | — |
| FOREIGN KEY | 23 | **29** | +6 composite FKs (Q02); all `ON DELETE RESTRICT` (Q07) |
| UNIQUE constraints | 10 | **12** | +2 supporting UNIQUE (Q02) |
| CHECK active | 21 (12 [A] + 9 [D]) | **11** [A] | 9 [D] moved to PENDING; A-12 SUPERSEDED by Q05 (N-10) |
| CHECK pending | — | **23** | D-01…D-09 + N-01…N-14 |
| Explicit index | 0 | **1** | `uq_fnd_module_versions_one_active` (Q01) |
| Indexes created implicitly | 24 | **26** | 14 PK + 12 UNIQUE (PostgreSQL creates one B-tree each) |
| Trigger / function / procedure / policy / role / GRANT / enum | 0 | **0** | — |
| Reference to schema `iam` | 0 | **0** | IAM links are logical UUIDs only |

## 2. Per table

| Table | Cols | PK | FK (composite) | UQ | CHECK active | Index (explicit + implicit) | CHECK pending |
|---|---:|---:|---:|---:|---:|---:|---|
| B01 fnd_modules | 9 | 1 | 0 | 1 | 1 | 0 + 2 | D-01 |
| B02 fnd_module_versions | 12 | 1 | 1 | 2 | 1 | 1 + 3 | D-04, D-05, D-06, N-03 |
| B03 fnd_functions | 6 | 1 | 3 (1) | 2 | 0 | 0 + 3 | D-02, D-07 |
| B04 fnd_actions | 5 | 1 | 1 | 1 | 0 | 0 + 2 | D-03 |
| B05 fnd_version_functions | 7 | 1 | 2 | 1 | 0 | 0 + 2 | N-04 |
| B06 fnd_version_actions | 7 | 1 | 2 | 1 | 0 | 0 + 2 | N-05 |
| B07 fnd_module_events | 9 | 1 | 3 (1) | 0 | 0 | 0 + 1 | N-08 |
| B08 fnd_audit_logs | 15 | 1 | 3 (1) | 1 | 1 | 0 + 2 | N-01 |
| B09 fnd_navigation_items | 8 | 1 | 4 (1) | 0 | 0 | 0 + 1 | D-08, N-02 |
| B10 fnd_data_contracts | 11 | 1 | 1 | 1 | 1 | 0 + 2 | N-06, N-11 |
| B11 fnd_data_fields | 9 | 1 | 1 | 1 | 0 | 0 + 2 | N-14 |
| B12 fnd_data_access_rules | 8 | 1 | 2 | 1 | 2 | 0 + 2 | D-09, N-12 |
| B13 fnd_compatibility_checks | 9 | 1 | 5 (2) | 0 | 3 | 0 + 1 | N-07, N-13 |
| B14 fnd_compatibility_changes | 10 | 1 | 1 | 0 | 2 | 0 + 1 | N-09, N-10 |
| **Total** | **125** | **14** | **29 (6)** | **12** | **11** | **1 + 26** | **23** |

## 3. Active [A] CHECKs (11) and the superseded one

| ID | Table | Constraint | Expression |
|---|---|---|---|
| A-01 | B01 | ck_fnd_modules_module_type | `module_type IN ('INTERNAL','EXTERNAL')` |
| A-02 | B02 | ck_fnd_module_versions_status | `status IN ('DRAFT','IN_REVIEW','APPROVED','ACTIVE','RETIRED','REJECTED')` |
| A-03 | B08 | ck_fnd_audit_logs_outcome | `outcome IN ('SUCCESS','FAILURE','DENIED')` |
| A-04 | B10 | ck_fnd_data_contracts_interface_kind | `interface_kind IN ('API','VIEW','EVENT','DIRECT_DB')` |
| A-05 | B12 | ck_fnd_data_access_rules_data_operation | `data_operation IN ('SELECT','INSERT','UPDATE','DELETE')` |
| A-06 | B12 | ck_fnd_data_access_rules_approval_mode | `approval_mode IN ('REQUIRED','NOT_REQUIRED','UNSPECIFIED')` |
| A-07 | B13 | ck_fnd_compatibility_checks_environment | `environment IN ('DEV','TEST','PROD')` |
| A-08 | B13 | ck_fnd_compatibility_checks_result | `check_result IN ('PASS','WARN','BLOCK','FAILED','PENDING')`; `BLOCK` = overall result (Q05) |
| A-09 | B13 | ck_fnd_compatibility_checks_distinct_versions | `from_version_id IS NULL OR from_version_id <> to_version_id` |
| A-10 | B14 | ck_fnd_compatibility_changes_type | `change_type IN ('ADDED','REMOVED','MODIFIED','MISSING')` |
| A-11 | B14 | ck_fnd_compatibility_changes_severity | `severity IN ('INFO','WARNING','BLOCKING')`; `BLOCKING` = severity of one change (Q05) |
| ~~A-12~~ | B14 | ck_fnd_compatibility_changes_area | **SUPERSEDED** by Q05; the 4 baseline values are replaced by 10 values in N-10 (PENDING) |

## 4. Q01 / Q02 objects (type approved by the owner, active in the draft, not executed)

| # | Object | Definition | Columns exist in the 125 |
|---|---|---|---|
| Q01 | partial UNIQUE index | `uq_fnd_module_versions_one_active ON foundation.fnd_module_versions (module_id) WHERE status = 'ACTIVE'` | B02.module_id, B02.status ✔ |
| Q02-U1 | UNIQUE | `uq_fnd_module_versions_version_module UNIQUE (version_id, module_id)` on B02 | ✔ |
| Q02-U2 | UNIQUE | `uq_fnd_functions_function_module UNIQUE (function_id, module_id)` on B03 | ✔ |
| Q02-F1 | composite FK | B03 `(replaces_function_id, module_id)` → B03 `(function_id, module_id)` | ✔ |
| Q02-F2 | composite FK | B07 `(version_id, module_id)` → B02 `(version_id, module_id)` | ✔ |
| Q02-F3 | composite FK | B08 `(version_id, module_id)` → B02 `(version_id, module_id)` | ✔ |
| Q02-F4 | composite FK | B09 `(function_id, module_id)` → B03 `(function_id, module_id)` | ✔ |
| Q02-F5 | composite FK | B13 `(from_version_id, module_id)` → B02 `(version_id, module_id)` | ✔ |
| Q02-F6 | composite FK | B13 `(to_version_id, module_id)` → B02 `(version_id, module_id)` | ✔ |

- All composite FKs use the default MATCH SIMPLE: the check is skipped when any column is NULL. For B08 and B09 the NULL case is closed by N-01 and N-02 (PENDING).
- The baseline single-column FKs on the same columns are kept as [A], because the baseline lists them. They are redundant with the composite FKs where `module_id` is NOT NULL.

## 5. Rules by enforcement category

### B01 fnd_modules
- **DATABASE:** PK; `module_key` UNIQUE; `module_type` value list (A-01); defaults (`is_enabled` = false, timestamps).
- **PENDING:** D-01 identifier format. Without it, the UNIQUE is case-sensitive.
- **BACKEND:**
  - `updated_at` maintenance (K03).
  - Enabling requires a MIC check.
  - Disable = hide menu and block API without deleting IAM grants (principle 11).
  - IAM matching on normalised codes (K05, Q03).
- **PRIVILEGE:** `module_key` and `module_type` immutable after registration (exclude them from the column UPDATE grant); no DELETE (K02).
- **BLOCKED:** —

### B02 fnd_module_versions
- **DATABASE:**
  - PK; FK → B01; UNIQUE(module_id, module_version); status list (A-02).
  - **One ACTIVE per Module (Q01 index).**
  - Superkey for Q02.
- **PENDING:** D-04 (MIC after DRAFT), D-05 (review fields), D-06 (activation time), N-03 (hash format).
- **BACKEND:**
  - **All state transitions (Q04, see Final Review §3).**
  - Retire-before-activate order inside one transaction.
  - Compatibility check passed and no open BLOCK before ACTIVE (rules 07, 08).
  - MIC completeness MIC-01…10.
  - RFC 8785 + SHA-256 content check.
  - Reviewer holds the IAM permission (rule 06).
  - `activated_at` kept on rollback.
  - MIC locked from IN_REVIEW (K04).
  - REJECTED immutable (rule 09).
- **PRIVILEGE:** no DELETE (K02). The K04 lock depends on the row status, so privileges alone cannot express it; it stays BACKEND.
- **BLOCKED:** IAM permission code for approving a Module, and the effective-grants API (G-R05).

### B03 fnd_functions
- **DATABASE:** PK; FK → B01; self FK; UNIQUE(module_id, function_key); **replacement in the same Module (Q02-F1)**; superkey for Q02.
- **PENDING:** D-02 format; D-07 no self-replacement.
- **BACKEND:**
  - Cycles of length ≥ 2 (Q06).
  - New key when the meaning changes (rule 03).
  - `retired_at` only on official retirement (K09).
- **PRIVILEGE:** `module_id` and `function_key` immutable; no DELETE (K02).
- **BLOCKED:** —

### B04 fnd_actions
- **DATABASE:** PK; FK → B03; UNIQUE(function_id, action_key).
- **PENDING:** D-03 format.
- **BACKEND:**
  - New key when the meaning changes (rule 05).
  - No automatic IAM grant (rule 08).
  - `retired_at` (K09).
- **PRIVILEGE:** `function_id` immutable ("không tự chuyển Function"); no DELETE (K02).
- **BLOCKED:** —

### B05 fnd_version_functions
- **DATABASE:** PK; FKs → B02, B03; UNIQUE(version_id, function_id).
- **PENDING:** N-04 hash format.
- **BACKEND:**
  - **Version and Function in the same Module.** No `module_id` column exists, so no FK form is possible (BACKEND REQUIRED, Q02).
  - Definition locked from IN_REVIEW (K04).
  - `definition_hash` present when the definition is complete.
  - A route does not grant visibility.
- **PRIVILEGE:** no UPDATE/DELETE after IN_REVIEW. This is row-dependent, so it is BACKEND.
- **BLOCKED:** —

### B06 fnd_version_actions
- **DATABASE:** PK; FKs → B05, B04; UNIQUE(version_function_id, action_id).
- **PENDING:** N-05 hash format.
- **BACKEND:**
  - **Action belongs to the Function of the version_function.** No `function_id` column exists (BACKEND REQUIRED, Q02).
  - Declarations locked from IN_REVIEW (K04).
  - No inherited permission (rule 08).
- **PRIVILEGE:** as B05.
- **BLOCKED:** —

### B07 fnd_module_events
- **DATABASE:** PK; FKs → B01, B02; **version in the same Module (Q02-F2)**.
- **PENDING:** N-08 event_type list.
- **BACKEND:**
  - Content of `before_state`/`after_state`.
  - No unnecessary sensitive data.
  - Correlation id.
- **PRIVILEGE:** **append-only**: INSERT and SELECT only, no UPDATE/DELETE (Q07, K02, K12).
- **BLOCKED:** —

### B08 fnd_audit_logs
- **DATABASE:** PK; `event_id` UNIQUE (anti-duplicate, **not** an FK to B07, Q07); FKs → B01, B02; **module/version in the same Module (Q02-F3)**; outcome list (A-03).
- **PENDING:** N-01 (version requires module).
- **BACKEND:**
  - Actor and outcome decided by the backend (K12).
  - **No success reported without a guaranteed audit row** (rule 26). Transaction or outbox mechanism to be decided.
  - `metadata` without passwords or tokens (DAT-05).
  - `occurred_at` supplied by the source.
- **PRIVILEGE:** **append-only**: only the trusted service role may INSERT; nobody may UPDATE/DELETE (Q07).
- **BLOCKED:** `action_code` list (K07, Q05: not approved, no CHECK).

### B09 fnd_navigation_items
- **DATABASE:** PK; FKs → B09, B01, B03; **function in the same Module (Q02-F4)**; defaults (`sort_order` = 0, `is_visible` = true).
- **PENDING:** D-08 (not own parent); N-02 (function requires module).
- **BACKEND:**
  - Cycles of length ≥ 2 (Q06).
  - Show only Functions of an ACTIVE version with IAM grants (K08, principle 10).
- **PRIVILEGE:** —
- **BLOCKED:** —

### B10 fnd_data_contracts
- **DATABASE:** PK; FK → B02; UNIQUE(version_id, resource_key); interface_kind list (A-04).
- **PENDING:** N-06 hash format; N-11 (DIRECT_DB requires schema and table).
- **BACKEND:**
  - DIRECT_DB needs a separate approval (principle 17).
  - No table or column is generated from `contract_spec`.
  - RFC 8785 + SHA-256 content check.
  - Locked from IN_REVIEW (K04).
- **PRIVILEGE:** no GRANT is derived from a contract.
- **BLOCKED:** —

### B11 fnd_data_fields
- **DATABASE:** PK; FK → B10; UNIQUE(data_contract_id, field_name).
- **PENDING:** N-14 (`references_target` format).
- **BACKEND:**
  - Descriptive only: no DDL is executed from `field_type`/`default_expression`.
  - Locked from IN_REVIEW (K04).
- **PRIVILEGE:** —
- **BLOCKED:** identifier grammar for N-14 (G-R04).

### B12 fnd_data_access_rules
- **DATABASE:** PK; FKs → B10, B06; UNIQUE(data_contract_id, version_action_id, data_operation); operation list (A-05); approval_mode list (A-06).
- **PENDING:** D-09 (REQUIRED ⇒ workflow_key); N-12 (enabled ⇒ not UNSPECIFIED).
- **BACKEND:**
  - **Data Contract and Version Action in the same Version.** This spans B10, B06 and B05 (BACKEND REQUIRED, Q02).
  - Workflow validity.
  - No Permission or GRANT created (principle 22).
- **PRIVILEGE:** —
- **BLOCKED:** —

### B13 fnd_compatibility_checks
- **DATABASE:** PK; FKs → B01, B02 ×2; **source and target in the same Module (Q02-F5, F6)**; distinct versions (A-09); environment (A-07) and result (A-08) lists.
- **PENDING:** N-07 fingerprint format; N-13 (completed after start).
- **BACKEND:**
  - BLOCK forbids activation (rule 07).
  - `completed_at` set when finished.
  - How the fingerprint is computed.
- **PRIVILEGE:** —
- **BLOCKED:** whether `database_fingerprint` is SHA-256, and of what content (G-R03).

### B14 fnd_compatibility_changes
- **DATABASE:** PK; FK → B13; change_type (A-10) and severity (A-11) lists.
- **PENDING:** N-09 resolution_status; N-10 change_area (replaces A-12).
- **BACKEND:**
  - A BLOCKING change is resolved only by fixing and re-checking, not by setting RESOLVED (K11).
  - No automatic database repair or grant.
- **PRIVILEGE:** —
- **BLOCKED:** —

## 6. History preservation (Q07): confirmation
- **Constraint:**
  - Every FK uses `ON DELETE RESTRICT` (29/29), so a referenced Module, Version, Function, Action, Contract or Check cannot be deleted while history points to it.
  - No `ON DELETE CASCADE` and no `ON UPDATE` action exist.
- **PostgreSQL privilege (Gate 3, not created here):**
  - No DELETE on any Foundation table for runtime roles (K02).
  - No UPDATE on `fnd_module_events` and `fnd_audit_logs`.
  - INSERT on `fnd_audit_logs` only for the trusted service role (K12).
  - Column-level UPDATE lists that exclude immutable keys.
- **Backend:**
  - K04 lock of MIC and declarations from IN_REVIEW.
  - REJECTED immutable.
  - Retire-before-activate transaction.
  - Audit guaranteed before reporting success.
- **Not used:** triggers, rules, policies (Q07: no trigger to enforce immutability).
