# F2-DB-GATE2 — CONSTRAINT COVERAGE MATRIX (REVISION-02)

**Task:** F2-DB-GATE2-REVISION-02 · **Baseline:** Foundation Database Design v1.0 · **Decisions applied:** Q01–Q08 (REVISION-01) and the owner CHECK decisions (REVISION-02) · **Git HEAD before this revision:** `31d3fc2`
**Source of the counts:** static analysis of `F2-DB-GATE2-REVISED-DDL-DRAFT.sql` by script, with no database. Nothing was executed.

Categories:
- **DATABASE (ACTIVE):** guaranteed by a constraint or index that is active in the draft. This covers [A] from the baseline, [Q01]/[Q02] approved by the owner, and the CHECKs OWNER APPROVED in REVISION-02.
- **PENDING:** a CHECK expression still awaiting owner review (N-07, N-14). It is not active; see `F2-DB-GATE2-CHECK-D-REVIEW.md`.
- **BACKEND:** must be enforced by the trusted backend service; no declarative form exists within 14 tables / 125 columns without triggers.
- **PRIVILEGE:** needs PostgreSQL privileges (column UPDATE lists, no UPDATE/DELETE). Roles and grants are **not created**; they are decided in Gate 3.
- **BLOCKED:** a definition is missing — DECISION REQUIRED.

"Active" means active **in the draft text only**. No constraint exists in any database.

## 1. Totals

| Item | Gate 2 | Revision-01 | Revision-02 | Change in Revision-02 |
|---|---:|---:|---:|---|
| Tables | 14 | 14 | **14** | unchanged |
| Columns | 125 | 125 | **125** | unchanged (names, types, NULL, DEFAULT identical to baseline) |
| PRIMARY KEY | 14 | 14 | **14** | — |
| FOREIGN KEY | 23 | 29 | **29** | — (23 single + 6 composite; all `ON DELETE RESTRICT`) |
| UNIQUE constraints | 10 | 12 | **12** | — |
| Explicit index | 0 | 1 | **1** | — (`uq_fnd_module_versions_one_active`, Q01) |
| Indexes created implicitly (PK + UNIQUE) | 24 | 26 | **26** | — |
| CHECK active | 21 | 11 | **32** | +19 OWNER APPROVED + 2 OWNER APPROVED — REVISED |
| CHECK pending | — | 23 | **2** | N-07, N-14 |
| CHECK superseded | — | 1 | **1** | A-12 (replaced by N-10) |
| Trigger / function / procedure / policy / role / GRANT / enum | 0 | 0 | **0** | — |
| Reference to schema `iam` | 0 | 0 | **0** | — |

CHECK breakdown (32): 11 [A] baseline (A-01…A-11) · 19 OWNER APPROVED (D-01…D-08, N-01…N-06, N-08, N-09, N-10, N-12, N-13) · 2 OWNER APPROVED — REVISED (D-09, N-11).

## 2. Per table

| Table | Cols | PK | FK (composite) | UQ | Index (explicit + implicit) | CHECK active | of which [A] | of which approved D/N | CHECK pending |
|---|---:|---:|---:|---:|---:|---:|---|---|---|
| B01 fnd_modules | 9 | 1 | 0 | 1 | 0 + 2 | 2 | A-01 | D-01 | — |
| B02 fnd_module_versions | 12 | 1 | 1 | 2 | 1 + 3 | 5 | A-02 | D-04, D-05, D-06, N-03 | — |
| B03 fnd_functions | 6 | 1 | 3 (1) | 2 | 0 + 3 | 2 | — | D-02, D-07 | — |
| B04 fnd_actions | 5 | 1 | 1 | 1 | 0 + 2 | 1 | — | D-03 | — |
| B05 fnd_version_functions | 7 | 1 | 2 | 1 | 0 + 2 | 1 | — | N-04 | — |
| B06 fnd_version_actions | 7 | 1 | 2 | 1 | 0 + 2 | 1 | — | N-05 | — |
| B07 fnd_module_events | 9 | 1 | 3 (1) | 0 | 0 + 1 | 1 | — | N-08 | — |
| B08 fnd_audit_logs | 15 | 1 | 3 (1) | 1 | 0 + 2 | 2 | A-03 | N-01 | — |
| B09 fnd_navigation_items | 8 | 1 | 4 (1) | 0 | 0 + 1 | 2 | — | D-08, N-02 | — |
| B10 fnd_data_contracts | 11 | 1 | 1 | 1 | 0 + 2 | 3 | A-04 | N-06, N-11 (REVISED) | — |
| B11 fnd_data_fields | 9 | 1 | 1 | 1 | 0 + 2 | 0 | — | — | N-14 |
| B12 fnd_data_access_rules | 8 | 1 | 2 | 1 | 0 + 2 | 4 | A-05, A-06 | D-09 (REVISED), N-12 | — |
| B13 fnd_compatibility_checks | 9 | 1 | 5 (2) | 0 | 0 + 1 | 4 | A-07, A-08, A-09 | N-13 | N-07 |
| B14 fnd_compatibility_changes | 10 | 1 | 1 | 0 | 0 + 1 | 4 | A-10, A-11 | N-09, N-10 | — |
| **Total** | **125** | **14** | **29 (6)** | **12** | **1 + 26** | **32** | **11** | **21** | **2** |

## 3. Active CHECKs (32)

### 3.1 Baseline [A] (11) and the superseded one

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
| ~~A-12~~ | B14 | (name now used by N-10) | **SUPERSEDED** by Q05: 4 baseline values replaced by the 10 values of N-10 |

### 3.2 Owner-approved D / N (21)

| ID | Table | Constraint | Status |
|---|---|---|---|
| D-01 | B01 | ck_fnd_modules_module_key_format | OWNER APPROVED |
| D-02 | B03 | ck_fnd_functions_function_key_format | OWNER APPROVED |
| D-03 | B04 | ck_fnd_actions_action_key_format | OWNER APPROVED |
| D-04 | B02 | ck_fnd_module_versions_manifest_required | OWNER APPROVED |
| D-05 | B02 | ck_fnd_module_versions_review | OWNER APPROVED |
| D-06 | B02 | ck_fnd_module_versions_activation | OWNER APPROVED |
| D-07 | B03 | ck_fnd_functions_not_self_replacing | OWNER APPROVED |
| D-08 | B09 | ck_fnd_navigation_items_not_own_parent | OWNER APPROVED |
| D-09 | B12 | ck_fnd_data_access_rules_workflow_when_required | **OWNER APPROVED — REVISED** (non-blank `workflow_key`) |
| N-01 | B08 | ck_fnd_audit_logs_version_requires_module | OWNER APPROVED |
| N-02 | B09 | ck_fnd_navigation_items_function_requires_module | OWNER APPROVED |
| N-03 | B02 | ck_fnd_module_versions_manifest_hash_format | OWNER APPROVED |
| N-04 | B05 | ck_fnd_version_functions_definition_hash_format | OWNER APPROVED |
| N-05 | B06 | ck_fnd_version_actions_definition_hash_format | OWNER APPROVED |
| N-06 | B10 | ck_fnd_data_contracts_contract_hash_format | OWNER APPROVED |
| N-08 | B07 | ck_fnd_module_events_event_type | OWNER APPROVED |
| N-09 | B14 | ck_fnd_compatibility_changes_resolution_status | OWNER APPROVED |
| N-10 | B14 | ck_fnd_compatibility_changes_area | OWNER APPROVED (replaces A-12) |
| N-11 | B10 | ck_fnd_data_contracts_direct_db_target | **OWNER APPROVED — REVISED** (non-blank schema and table for DIRECT_DB) |
| N-12 | B12 | ck_fnd_data_access_rules_enabled_needs_mode | OWNER APPROVED |
| N-13 | B13 | ck_fnd_compatibility_checks_completed_after_start | OWNER APPROVED |

Exact expressions: `F2-DB-GATE2-CHECK-D-REVIEW.md` (identical text in the DDL draft, verified by script).

### 3.3 Pending (2)

| ID | Table | Constraint | Reason |
|---|---|---|---|
| N-07 | B13 | ck_fnd_compatibility_checks_fingerprint_format | fingerprint algorithm and metadata input not decided; SHA-256 not assumed |
| N-14 | B11 | ck_fnd_data_fields_references_target_format | regex, quoted identifiers and letter case not decided; K10 rule kept |

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

- All composite FKs use MATCH SIMPLE, so the check is skipped when any column is NULL.
- For B08 and B09, the case "version/function set but module NULL" is now closed by the approved CHECKs N-01 and N-02.
- The baseline single-column FKs on the same columns are kept as [A].

## 5. Rules by enforcement category

### B01 fnd_modules
- **DATABASE:** PK; `module_key` UNIQUE; `module_type` list (A-01); **identifier format D-01**; defaults. With D-01 only upper-case keys exist, so the UNIQUE is effectively case-insensitive (K01).
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
  - **D-04** (MIC + hash after DRAFT), **D-05** (review fields), **D-06** (activation time), **N-03** (hash format).
- **BACKEND:**
  - **All state transitions (Q04, Final Review §3).**
  - Retire-before-activate order in one transaction.
  - Compatibility check passed and no open BLOCK before ACTIVE.
  - MIC completeness MIC-01…10.
  - RFC 8785 + SHA-256 content equality.
  - Reviewer holds the IAM permission.
  - `activated_at` kept on rollback.
  - MIC locked from IN_REVIEW (K04).
  - REJECTED immutable.
- **PRIVILEGE:** no DELETE (K02). The K04 lock is row-dependent, so it stays BACKEND.
- **BLOCKED:** IAM permission code for approving a Module, and the effective-grants API (G-R05).

### B03 fnd_functions
- **DATABASE:** PK; FK → B01; self FK; UNIQUE(module_id, function_key); replacement in the same Module (Q02-F1); superkey; **D-02** (format); **D-07** (no self-replacement).
- **BACKEND:**
  - Cycles of length ≥ 2 (Q06).
  - New key when the meaning changes.
  - `retired_at` (K09).
- **PRIVILEGE:** `module_id` and `function_key` immutable; no DELETE (K02).
- **BLOCKED:** —

### B04 fnd_actions
- **DATABASE:** PK; FK → B03; UNIQUE(function_id, action_key); **D-03** (format).
- **BACKEND:**
  - New key when the meaning changes.
  - No automatic IAM grant.
  - `retired_at` (K09).
- **PRIVILEGE:** `function_id` immutable; no DELETE (K02).
- **BLOCKED:** —

### B05 fnd_version_functions
- **DATABASE:** PK; FKs → B02, B03; UNIQUE(version_id, function_id); **N-04** (hash format).
- **BACKEND:**
  - **Version and Function in the same Module** (BACKEND REQUIRED: no `module_id` column).
  - K04 lock.
  - `definition_hash` present when complete, and equal to its content.
  - A route does not grant visibility.
- **PRIVILEGE:** the lock after IN_REVIEW is row-dependent, so it is BACKEND.
- **BLOCKED:** —

### B06 fnd_version_actions
- **DATABASE:** PK; FKs → B05, B04; UNIQUE(version_function_id, action_id); **N-05** (hash format).
- **BACKEND:**
  - **Action belongs to the Function of the version_function** (BACKEND REQUIRED: no `function_id` column).
  - K04 lock.
  - Hash content.
  - No inherited permission.
- **PRIVILEGE:** as B05.
- **BLOCKED:** —

### B07 fnd_module_events
- **DATABASE:** PK; FKs → B01, B02; version in the same Module (Q02-F2); **N-08** (event types).
- **BACKEND:**
  - Content of `before_state`/`after_state`.
  - No unnecessary sensitive data.
  - ROLLBACK only after an approved compatibility check.
- **PRIVILEGE:** **append-only**: INSERT and SELECT only, no UPDATE/DELETE (Q07, K02, K12).
- **BLOCKED:** —

### B08 fnd_audit_logs
- **DATABASE:** PK; `event_id` UNIQUE (anti-duplicate, not an FK to B07); FKs → B01, B02; same Module (Q02-F3); outcome (A-03); **N-01** (version requires module).
- **BACKEND:**
  - Actor and outcome decided by the backend (K12).
  - No success reported without a guaranteed audit row (mechanism G-R07).
  - `metadata` without passwords or tokens.
  - `occurred_at` supplied by the source.
- **PRIVILEGE:** **append-only**: only the trusted service role may INSERT; nobody may UPDATE/DELETE (Q07).
- **BLOCKED:** `action_code` list (K07; G-R06).

### B09 fnd_navigation_items
- **DATABASE:** PK; FKs → B09, B01, B03; function in the same Module (Q02-F4); **D-08** (not own parent); **N-02** (function requires module); defaults.
- **BACKEND:**
  - Cycles of length ≥ 2 (Q06).
  - Show only Functions of an ACTIVE version with IAM grants (K08).
- **PRIVILEGE:** —
- **BLOCKED:** —

### B10 fnd_data_contracts
- **DATABASE:** PK; FK → B02; UNIQUE(version_id, resource_key); interface_kind (A-04); **N-06** (hash format); **N-11 REVISED** (DIRECT_DB requires non-blank schema and table).
- **BACKEND:**
  - DIRECT_DB still needs a separate approval (principle 17; owner decision REVISION-02).
  - Schema/table existence.
  - No DDL generated from `contract_spec`.
  - Hash content.
  - K04 lock.
- **PRIVILEGE:** no GRANT is derived from a contract.
- **BLOCKED:** —

### B11 fnd_data_fields
- **DATABASE:** PK; FK → B10; UNIQUE(data_contract_id, field_name).
- **PENDING:** **N-14** (`references_target` format).
- **BACKEND:**
  - K10 `schema.table.column` validation, until N-14 is decided.
  - Descriptive only: no DDL from `field_type`/`default_expression`.
  - K04 lock.
- **PRIVILEGE:** —
- **BLOCKED:** identifier grammar of `references_target` (G-R04).

### B12 fnd_data_access_rules
- **DATABASE:** PK; FKs → B10, B06; UNIQUE(data_contract_id, version_action_id, data_operation); A-05; A-06; **D-09 REVISED** (REQUIRED ⇒ non-blank `workflow_key`); **N-12** (enabled ⇒ not UNSPECIFIED).
- **BACKEND:**
  - **Data Contract and Version Action in the same Version** (BACKEND REQUIRED).
  - The workflow exists and is valid (owner decision REVISION-02).
  - No Permission or GRANT created.
- **PRIVILEGE:** —
- **BLOCKED:** —

### B13 fnd_compatibility_checks
- **DATABASE:** PK; FKs → B01, B02 ×2; same Module (Q02-F5, F6); A-07; A-08; A-09; **N-13** (completed ≥ started).
- **PENDING:** **N-07** (`database_fingerprint` format).
- **BACKEND:**
  - BLOCK forbids activation.
  - `completed_at` set when finished.
  - Fingerprint computation (not defined).
- **PRIVILEGE:** —
- **BLOCKED:** fingerprint algorithm and metadata input (G-R03).

### B14 fnd_compatibility_changes
- **DATABASE:** PK; FK → B13; A-10; A-11; **N-09** (OPEN/RESOLVED); **N-10** (10 change areas, replaces A-12).
- **BACKEND:**
  - A BLOCKING change is resolved only by fixing and re-checking (K11).
  - `object_key` consistent with the area.
- **PRIVILEGE:** —
- **BLOCKED:** —

## 6. History preservation (Q07): confirmation
- **Constraint:**
  - Every FK uses `ON DELETE RESTRICT` (29/29).
  - No `ON DELETE CASCADE` and no `ON UPDATE` action exist.
- **PostgreSQL privilege (Gate 3, not created here):**
  - No DELETE on Foundation tables for runtime roles (K02).
  - No UPDATE on `fnd_module_events` and `fnd_audit_logs`.
  - INSERT on `fnd_audit_logs` only for the trusted service role (K12).
  - Column-level UPDATE lists that exclude immutable keys.
- **Backend:**
  - K04 lock of MIC and declarations from IN_REVIEW.
  - REJECTED immutable.
  - Retire-before-activate transaction.
  - Audit guaranteed before reporting success.
- **Not used:** triggers, rules, policies.
