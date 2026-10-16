# F2-DB-GATE2 — CHECK REVIEW CATALOG (D-01…D-09, N-01…N-14)

**Task:** F2-DB-GATE2-REVISION-01 · **Baseline:** Foundation Database Design v1.0 (14 tables / 125 columns) · **Git HEAD:** `4508cbb` (owner commit of the baseline documents; their SHA-256 is unchanged)
**Status of every item below: PENDING OWNER REVIEW.** None is active in `F2-DB-GATE2-REVISED-DDL-DRAFT.sql` (they appear there only as comments). Nothing was executed.

- **D-01…D-09:** the 9 `[D]` CHECKs of the Gate 2 report. D-01…D-03 and D-06 carry a revised expression that follows the owner decisions Q03 and Q04; the Gate 2 expression is shown for comparison.
- **N-01…N-14:** **NEW — PENDING OWNER REVIEW**: CHECKs that arise from Q02, Q03, Q05 and Q06. N-10 replaces the baseline CHECK A-12 (4 values of `change_area`), which Q05 superseded.
- Notation for examples: `(column=value, …)`. "Valid" means that the CHECK accepts the row, and "Invalid" means that it rejects the row. Every expression is checked only against the row being written; a PostgreSQL CHECK never sees other rows or the previous value.
- Regular expressions use PostgreSQL `~` (case-sensitive). Behaviour on a real server is **NOT_TESTED**.

Approve, reject or amend each ID separately. An approved item becomes an active `CONSTRAINT … CHECK (…)` in the Gate 3 script, with the name shown.

---

## Summary

| ID | Table | Constraint name | Origin | Expression (short) |
|---|---|---|---|---|
| D-01 | B01 fnd_modules | ck_fnd_modules_module_key_format | K01 + Q03 (REVISED) | `module_key ~ '^[A-Z][A-Z0-9_]*$'` |
| D-02 | B03 fnd_functions | ck_fnd_functions_function_key_format | K01 + Q03 (REVISED) | `function_key ~ '^[A-Z][A-Z0-9_]*$'` |
| D-03 | B04 fnd_actions | ck_fnd_actions_action_key_format | K01 + Q03 (REVISED) | `action_key ~ '^[A-Z][A-Z0-9_]*$'` |
| D-04 | B02 fnd_module_versions | ck_fnd_module_versions_manifest_required | B02 rule 11 | MIC + hash required after DRAFT |
| D-05 | B02 fnd_module_versions | ck_fnd_module_versions_review | B02 rule 15 | reviewer/time NULL ⇔ DRAFT/IN_REVIEW |
| D-06 | B02 fnd_module_versions | ck_fnd_module_versions_activation | B02 rule 15 + Q04 (REVISED) | activated_at NOT NULL ⇔ ACTIVE/RETIRED |
| D-07 | B03 fnd_functions | ck_fnd_functions_not_self_replacing | B03 rule (cycles) | no self-reference |
| D-08 | B09 fnd_navigation_items | ck_fnd_navigation_items_not_own_parent | B09 rule (cycles) | no self-parent |
| D-09 | B12 fnd_data_access_rules | ck_fnd_data_access_rules_workflow_when_required | B12 rule | REQUIRED ⇒ workflow_key present |
| N-01 | B08 fnd_audit_logs | ck_fnd_audit_logs_version_requires_module | Q02 | version_id ⇒ module_id |
| N-02 | B09 fnd_navigation_items | ck_fnd_navigation_items_function_requires_module | Q02 | function_id ⇒ module_id |
| N-03 | B02 fnd_module_versions | ck_fnd_module_versions_manifest_hash_format | Q03 | 64 lowercase hex or NULL |
| N-04 | B05 fnd_version_functions | ck_fnd_version_functions_definition_hash_format | Q03 | 64 lowercase hex or NULL |
| N-05 | B06 fnd_version_actions | ck_fnd_version_actions_definition_hash_format | Q03 | 64 lowercase hex or NULL |
| N-06 | B10 fnd_data_contracts | ck_fnd_data_contracts_contract_hash_format | Q03 | 64 lowercase hex |
| N-07 | B13 fnd_compatibility_checks | ck_fnd_compatibility_checks_fingerprint_format | Q03 (scope to confirm) | 64 lowercase hex or NULL |
| N-08 | B07 fnd_module_events | ck_fnd_module_events_event_type | Q05 | 9 event types |
| N-09 | B14 fnd_compatibility_changes | ck_fnd_compatibility_changes_resolution_status | Q05 | OPEN, RESOLVED |
| N-10 | B14 fnd_compatibility_changes | ck_fnd_compatibility_changes_area | Q05 (replaces A-12) | 10 areas |
| N-11 | B10 fnd_data_contracts | ck_fnd_data_contracts_direct_db_target | Q06 | DIRECT_DB ⇒ schema + table |
| N-12 | B12 fnd_data_access_rules | ck_fnd_data_access_rules_enabled_needs_mode | Q06 | enabled ⇒ not UNSPECIFIED |
| N-13 | B13 fnd_compatibility_checks | ck_fnd_compatibility_checks_completed_after_start | Q06 | completed_at ≥ started_at |
| N-14 | B11 fnd_data_fields | ck_fnd_data_fields_references_target_format | Q06 + K10 | `schema.table.column` |

---

## D-01 · D-02 · D-03 — identifier format (K01, Q03) — PENDING OWNER REVIEW

| | D-01 | D-02 | D-03 |
|---|---|---|---|
| Table / column | B01 `fnd_modules.module_key` VARCHAR(80) | B03 `fnd_functions.function_key` VARCHAR(100) | B04 `fnd_actions.action_key` VARCHAR(30) |
| Constraint | `ck_fnd_modules_module_key_format` | `ck_fnd_functions_function_key_format` | `ck_fnd_actions_action_key_format` |

**Rule:** K01 and Q03 require that the identifier uses only A–Z, 0–9 and `_`, starts with a letter and is not empty. Duplicates are checked without regard to case.

```sql
CHECK (module_key   ~ '^[A-Z][A-Z0-9_]*$')   -- D-01
CHECK (function_key ~ '^[A-Z][A-Z0-9_]*$')   -- D-02
CHECK (action_key   ~ '^[A-Z][A-Z0-9_]*$')   -- D-03
```
The Gate 2 expression was `'^[A-Z0-9_]+$'`. It was revised because Q03 adds the rule that the first character must be a letter.

- **Valid:** `SALES`, `SALES_ORDER`, `ORDER2`, `A`, `VIEW`.
- **Invalid:** `''` (empty), `sales`, `Sales`, `1SALES`, `_SALES`, `SALES-ORDER`, `SALES ORDER`, `ĐƠN_HÀNG`.
- **Not controlled:**
  - A trailing underscore or a repeated underscore (`SALES_`, `A__B`) is allowed, because Q03 does not forbid it.
  - The maximum length comes from VARCHAR(n), not from this CHECK.
  - The CHECK does not cover the meaning of the key, or a rename of the key after registration (immutability is BACKEND/PRIVILEGE).
  - It does not cover the match with IAM codes (K05). That comparison is done by the backend on normalised codes; IAM is not changed.
  - The range `[A-Z]` is expected to use code points under the `en_US.utf8` database collation. This is NOT_TESTED.
- **Risk if not applied:** the existing UNIQUE constraints (`uq_fnd_modules_module_key`, `uq_fnd_functions_module_function_key`, `uq_fnd_actions_function_action_key`) are **case-sensitive**. Without D-01…D-03, both `SALES` and `Sales` can be stored, so the K01 case-insensitive uniqueness depends only on the backend normalising the codes.

## D-04 — MIC required after DRAFT (B02 rule 11) — PENDING OWNER REVIEW
- **Table / columns:** B02 `status`, `manifest_json`, `manifest_hash` · **Constraint:** `ck_fnd_module_versions_manifest_required`
- **Rule:** a DRAFT version may lack the MIC; from IN_REVIEW on, the MIC and its hash are mandatory. Under Q04 every non-DRAFT status is reached through IN_REVIEW, because DRAFT → REJECTED is not allowed.
```sql
CHECK (status = 'DRAFT' OR (manifest_json IS NOT NULL AND manifest_hash IS NOT NULL))
```
- **Valid:** `(DRAFT, json=NULL, hash=NULL)`, `(DRAFT, json={…}, hash=NULL)`, `(IN_REVIEW, json={…}, hash=…)`, `(RETIRED, json={…}, hash=…)`.
- **Invalid:** `(IN_REVIEW, json=NULL, hash=…)`, `(APPROVED, json={…}, hash=NULL)`, `(REJECTED, json=NULL, hash=NULL)`.
- **Not controlled:**
  - Whether the MIC contains MIC-01…MIC-10.
  - Whether the hash equals SHA-256 of the RFC 8785 form (BACKEND).
  - The format of the hash (N-03).
  - The MIC lock after IN_REVIEW (K04: BACKEND/PRIVILEGE).
  - `manifest_json = 'null'::jsonb` (a JSON null value, not SQL NULL) passes.
- **Risk if not applied:** a version can reach IN_REVIEW, APPROVED or ACTIVE without a MIC or without a hash, so later compatibility checks have nothing to compare.

## D-05 — review fields (B02 rule 15) — PENDING OWNER REVIEW
- **Table / columns:** B02 `status`, `reviewed_by_account_id`, `reviewed_at` · **Constraint:** `ck_fnd_module_versions_review`
- **Rule:** the reviewer and review time are NULL before the decision. They are recorded at APPROVED or REJECTED, and they are kept through ACTIVE, RETIRED and a rollback to ACTIVE.
```sql
CHECK ((status IN ('DRAFT','IN_REVIEW')) = (reviewed_at IS NULL)
   AND (status IN ('DRAFT','IN_REVIEW')) = (reviewed_by_account_id IS NULL))
```
- **Valid:** `(DRAFT, NULL, NULL)`, `(IN_REVIEW, NULL, NULL)`, `(APPROVED, acc, ts)`, `(REJECTED, acc, ts)`, `(ACTIVE, acc, ts)`, `(RETIRED, acc, ts)`.
- **Invalid:** `(IN_REVIEW, acc, ts)`, `(APPROVED, NULL, ts)`, `(REJECTED, acc, NULL)`, `(ACTIVE, NULL, NULL)`.
- **Not controlled:**
  - The reviewer holds the IAM permission (BACKEND; that permission is not defined yet).
  - The account exists in IAM (logical reference only, no FK).
  - `reviewed_at ≥ created_at`.
  - The values are not overwritten later (BACKEND/PRIVILEGE).
- **Risk if not applied:** an APPROVED/ACTIVE version can have no recorded reviewer, which breaks traceability (B02 rule 15, FND-08).

## D-06 — activation time (B02 rule 15, Q04) — PENDING OWNER REVIEW (REVISED)
- **Table / columns:** B02 `status`, `activated_at` · **Constraint:** `ck_fnd_module_versions_activation`
- **Rule:** `activated_at` holds the first activation.
  - Under Q04, ACTIVE is reached only from APPROVED or RETIRED, and RETIRED only from ACTIVE.
  - APPROVED is reached only from IN_REVIEW, so an APPROVED version has never been active.
  - Therefore `activated_at` is set exactly for ACTIVE and RETIRED.
```sql
CHECK ((status IN ('ACTIVE','RETIRED')) = (activated_at IS NOT NULL))
```
The Gate 2 expression was weaker: `(status <> 'ACTIVE' OR activated_at IS NOT NULL) AND (status NOT IN ('DRAFT','IN_REVIEW','REJECTED') OR activated_at IS NULL)`. It left APPROVED and RETIRED open because the lifecycle was not yet decided.
- **Valid:** `(APPROVED, NULL)`, `(ACTIVE, ts)`, `(RETIRED, ts)`, `(DRAFT, NULL)`.
- **Invalid:** `(ACTIVE, NULL)`, `(RETIRED, NULL)`, `(APPROVED, ts)`, `(REJECTED, ts)`.
- **Not controlled:**
  - On rollback RETIRED → ACTIVE the backend must keep the existing value ("first activation"). The CHECK accepts an overwritten timestamp.
  - `activated_at ≥ reviewed_at`.
  - The transition itself (Q04: BACKEND).
- **Risk if not applied:** ACTIVE or RETIRED rows can lack the activation time, or APPROVED rows can show a false activation.

## D-07 — function does not replace itself (B03) — PENDING OWNER REVIEW
- **Table / columns:** B03 `function_id`, `replaces_function_id` · **Constraint:** `ck_fnd_functions_not_self_replacing`
```sql
CHECK (replaces_function_id IS NULL OR replaces_function_id <> function_id)
```
- **Valid:** `(F1, replaces=NULL)`, `(F2, replaces=F1)`.
- **Invalid:** `(F1, replaces=F1)`.
- **Not controlled:**
  - Cycles of length ≥ 2 (`F1→F2→F1`). Q06 assigns these to the BACKEND.
  - The same-Module rule is already enforced by the active Q02 composite FK `fk_fnd_functions_replaces_same_module`.
- **Risk if not applied:** a one-step self-cycle can be stored, and replacement chains can then loop.

## D-08 — menu item is not its own parent (B09) — PENDING OWNER REVIEW
- **Table / columns:** B09 `navigation_id`, `parent_id` · **Constraint:** `ck_fnd_navigation_items_not_own_parent`
```sql
CHECK (parent_id IS NULL OR parent_id <> navigation_id)
```
- **Valid:** `(N1, parent=NULL)`, `(N2, parent=N1)`.
- **Invalid:** `(N1, parent=N1)`.
- **Not controlled:** deeper cycles (`N1→N2→N1`, BACKEND per Q06), and depth limits (not specified).
- **Risk if not applied:** a self-parented menu can make the sidebar tree loop on the first level.

## D-09 — workflow present when approval is REQUIRED (B12) — PENDING OWNER REVIEW
- **Table / columns:** B12 `approval_mode`, `workflow_key` · **Constraint:** `ck_fnd_data_access_rules_workflow_when_required`
```sql
CHECK (approval_mode <> 'REQUIRED' OR workflow_key IS NOT NULL)
```
- **Valid:** `(REQUIRED, 'SALES_ORDER_APPROVAL')`, `(NOT_REQUIRED, NULL)`, `(UNSPECIFIED, NULL)`, `(NOT_REQUIRED, 'X')`.
- **Invalid:** `(REQUIRED, NULL)`.
- **Not controlled:**
  - Whether the workflow exists or is valid. No workflow table exists, so this is BACKEND.
  - An empty or blank string `''` or `'  '` passes. A stricter variant, if wanted, is `CHECK (approval_mode <> 'REQUIRED' OR (workflow_key IS NOT NULL AND btrim(workflow_key) <> ''))`; it is **not** proposed as the default and needs a separate owner choice.
- **Risk if not applied:** a rule can require approval without naming the workflow that performs it.

---

## N-01 — audit version requires module (Q02) — NEW — PENDING OWNER REVIEW
- **Table / columns:** B08 `version_id`, `module_id` · **Constraint:** `ck_fnd_audit_logs_version_requires_module`
- **Rule (Q02):** if B08 has a `version_id`, it must have a `module_id`, and both must belong to the same Module.
  - The active composite FK `fk_fnd_audit_logs_version_same_module` checks "same Module" only when both values are present (MATCH SIMPLE).
  - This CHECK closes the case where `version_id` is set and `module_id` is NULL.
  - MATCH FULL is not usable, because it would also reject `(module_id set, version_id NULL)`, which K06 and B08 allow.
```sql
CHECK (version_id IS NULL OR module_id IS NOT NULL)
```
- **Valid:** `(module=NULL, version=NULL)` (Foundation-wide, K06), `(module=M, version=NULL)`, `(module=M, version=V of M)`.
- **Invalid:** `(module=NULL, version=V)`.
- `(module=M1, version=V of M2)` is rejected by the active composite FK, not by this CHECK.
- **Not controlled:** whether an event that belongs to a Module was wrongly logged with `module_id = NULL` (BACKEND decides K06).
- **Risk if not applied:** an audit row can point to a version without its Module, and the "same Module" FK is then silently skipped.

## N-02 — menu function requires module (Q02) — NEW — PENDING OWNER REVIEW
- **Table / columns:** B09 `function_id`, `module_id` · **Constraint:** `ck_fnd_navigation_items_function_requires_module`
- **Rule (Q02):** if B09 has a `function_id`, it must have a `module_id` of the same Module. Same reasoning as N-01, with the active FK `fk_fnd_navigation_items_function_same_module`.
```sql
CHECK (function_id IS NULL OR module_id IS NOT NULL)
```
- **Valid:** `(module=NULL, function=NULL)` (system/parent menu, K08), `(module=M, function=NULL)`, `(module=M, function=F of M)`.
- **Invalid:** `(module=NULL, function=F)`.
- **Not controlled:**
  - Consistency of the Module with the parent menu item.
  - Visibility rules: ACTIVE version and IAM grants (K08: BACKEND).
- **Risk if not applied:** a screen entry can bypass the "same Module" FK and the per-Module disable rule (baseline principle 11).

## N-03 … N-07 — SHA-256 lowercase hexadecimal format (Q03) — NEW — PENDING OWNER REVIEW
**Rule (Q03):** a hash is SHA-256, written as 64 lowercase hexadecimal characters. JSON content is canonicalised with RFC 8785 before hashing.

| ID | Table.column | Nullable | Expression |
|---|---|---|---|
| N-03 | B02 `fnd_module_versions.manifest_hash` | yes | `CHECK (manifest_hash IS NULL OR manifest_hash ~ '^[0-9a-f]{64}$')` |
| N-04 | B05 `fnd_version_functions.definition_hash` | yes | `CHECK (definition_hash IS NULL OR definition_hash ~ '^[0-9a-f]{64}$')` |
| N-05 | B06 `fnd_version_actions.definition_hash` | yes | `CHECK (definition_hash IS NULL OR definition_hash ~ '^[0-9a-f]{64}$')` |
| N-06 | B10 `fnd_data_contracts.contract_hash` | no | `CHECK (contract_hash ~ '^[0-9a-f]{64}$')` |
| N-07 | B13 `fnd_compatibility_checks.database_fingerprint` | yes | `CHECK (database_fingerprint IS NULL OR database_fingerprint ~ '^[0-9a-f]{64}$')` |

- **Valid:** `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- **Invalid:**
  - The same value in UPPER CASE.
  - 63 characters: CHAR(64) pads with blanks, and the padding is removed before the regex is evaluated, so the check fails as intended. This is NOT_TESTED.
  - Any character outside `0-9a-f`.
  - A Base64 value.
- **Format check ≠ content check:** these CHECKs only prove the shape. Whether the hash equals SHA-256 of the RFC 8785 canonical content is **BACKEND**. PostgreSQL has no RFC 8785 canonicaliser, and no DB function or trigger is approved.
- **N-07 specific:** the baseline calls `database_fingerprint` a "Dấu kiểm tra metadata DB". It does not say SHA-256, and it does not say which metadata is hashed. **Confirm that Q03 applies to this column** before approving N-07.
- **Risk if not applied:** mixed-case or truncated hashes compare as different values, which produces false "MODIFIED" results in compatibility checks.

## N-08 — module event types (Q05) — NEW — PENDING OWNER REVIEW
- **Table / column:** B07 `event_type` VARCHAR(40) · **Constraint:** `ck_fnd_module_events_event_type`
```sql
CHECK (event_type IN ('REGISTER','SUBMIT','APPROVE','REJECT','ENABLE','DISABLE','ACTIVATE','RETIRE','ROLLBACK'))
```
- **Valid:** `ACTIVATE`.
- **Invalid:** `activate`, `UPGRADE`, `DELETE`.
- **Not controlled:**
  - That `before_state`/`after_state` match the event.
  - That ROLLBACK follows an approved compatibility check (BACKEND).
  - Adding an event type later requires a constraint change.
- **Risk if not applied:** free-text event types make the lifecycle history unreliable for audit and FND-08.

## N-09 — resolution status (Q05) — NEW — PENDING OWNER REVIEW
- **Table / column:** B14 `resolution_status` (default `OPEN`) · **Constraint:** `ck_fnd_compatibility_changes_resolution_status`
```sql
CHECK (resolution_status IN ('OPEN','RESOLVED'))
```
- **Valid:** `OPEN`, `RESOLVED`.
- **Invalid:** `CLOSED`, `IGNORED`, `resolved`.
- **Not controlled:** K11 says a BLOCKING change is resolved only by fixing the cause and re-checking, not by setting RESOLVED. That is BACKEND; the CHECK accepts `RESOLVED` at any time.
- **Risk if not applied:** arbitrary statuses can hide unresolved BLOCKING changes.

## N-10 — change area (Q05, replaces A-12) — NEW — PENDING OWNER REVIEW
- **Table / column:** B14 `change_area` VARCHAR(30) · **Constraint:** `ck_fnd_compatibility_changes_area`
- The baseline CHECK A-12 `change_area IN ('FUNCTION','ACTION','DATA','API')` is **SUPERSEDED** by Q05 and is not active in the revised draft.
```sql
CHECK (change_area IN ('FUNCTION','ACTION','DATA','API','MODULE','UI','IAM','AUDIT','COMPATIBILITY','INTEGRITY'))
```
- **Valid:** `IAM`, `AUDIT`, `INTEGRITY`.
- **Invalid:** `iam`, `SECURITY`, `DB`.
- **Not controlled:** that `object_key` matches the area (for example an IAM permission code under `IAM`). This is BACKEND.
- **Risk if not applied:** until N-10 is approved, B14 has **no** area check at all, because A-12 is superseded. The longest value, `COMPATIBILITY` (13 characters), fits VARCHAR(30).

## N-11 — DIRECT_DB names its physical target (Q06) — NEW — PENDING OWNER REVIEW
- **Table / columns:** B10 `interface_kind`, `schema_name`, `table_name` · **Constraint:** `ck_fnd_data_contracts_direct_db_target`
```sql
CHECK (interface_kind <> 'DIRECT_DB' OR (schema_name IS NOT NULL AND table_name IS NOT NULL))
```
- **Valid:** `(DIRECT_DB, 'sales', 'orders')`, `(API, NULL, NULL)`, `(VIEW, 'sales', 'v_orders')`.
- **Invalid:** `(DIRECT_DB, NULL, 'orders')`, `(DIRECT_DB, 'sales', NULL)`.
- **Not controlled:**
  - Whether the schema/table exists.
  - The separate approval of DIRECT_DB (baseline principle 17; BACKEND/governance).
  - Empty strings pass.
  - Non-DIRECT_DB rows may still carry names; Q06 does not forbid it.
- **Risk if not applied:** a direct database dependency can be declared without saying which table it touches, so drift reports (FND-05) cannot be produced.

## N-12 — enabled rule must have an approval mode (Q06) — NEW — PENDING OWNER REVIEW
- **Table / columns:** B12 `is_enabled`, `approval_mode` · **Constraint:** `ck_fnd_data_access_rules_enabled_needs_mode`
```sql
CHECK (NOT (is_enabled AND approval_mode = 'UNSPECIFIED'))
```
- **Valid:** `(false, UNSPECIFIED)` (the defaults), `(true, REQUIRED)`, `(true, NOT_REQUIRED)`.
- **Invalid:** `(true, UNSPECIFIED)`.
- **Not controlled:**
  - Who may enable a rule.
  - That a REQUIRED rule's workflow is valid (D-09 plus BACKEND).
  - That the version is ACTIVE (BACKEND).
- **Risk if not applied:** an enabled rule with UNSPECIFIED approval can be read as "no approval needed", which contradicts B12.

## N-13 — compatibility check ends after it starts (Q06) — NEW — PENDING OWNER REVIEW
- **Table / columns:** B13 `started_at`, `completed_at` · **Constraint:** `ck_fnd_compatibility_checks_completed_after_start`
```sql
CHECK (completed_at IS NULL OR completed_at >= started_at)
```
- **Owner choice:** `>=` allows an instantaneous check, while `>` would require a strictly later time. `>=` is proposed.
- **Valid:** `(started=10:00, completed=NULL)`, `(10:00, 10:00)`, `(10:00, 10:05)`.
- **Invalid:** `(10:00, 09:59)`.
- **Not controlled:** that `completed_at` is set exactly when `check_result` leaves PENDING. No approved rule says so, and it is **not** proposed here.
- **Risk if not applied:** a check can appear to finish before it started, which corrupts the timeline evidence.

## N-14 — references_target format `schema.table.column` (Q06, K10) — NEW — PENDING OWNER REVIEW
- **Table / column:** B11 `references_target` VARCHAR(250) · **Constraint:** `ck_fnd_data_fields_references_target_format`
```sql
CHECK (references_target IS NULL
       OR references_target ~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$')
```
- **Grammar proposed:** three unquoted PostgreSQL identifiers in lower case (`a-z`, `0-9`, `_`, not starting with a digit), separated by single dots. This matches the naming style of IAM v0.3. **The owner must confirm this grammar**, because Q06 states only `schema.table.column`.
- **Valid:** `iam.iam_user_accounts.user_account_id`, `sales.orders.order_id`.
- **Invalid:** `orders.order_id` (two parts), `a.b.c.d`, `Sales.Orders.ID`, `"Sales"."Order".id`, `sales.orders.order-id`, `sales..id`.
- **Not controlled:**
  - Whether the target exists.
  - Quoted or upper-case identifiers, and the `$` character, which PostgreSQL allows but this grammar rejects.
  - The 63-byte identifier limit; longer parts pass.
  - Non-physical references: K10 says "khi trỏ dữ liệu vật lý". With this CHECK, every non-NULL value must be physical.
- **Risk if not applied:** free-form references cannot be compared reliably during schema drift detection (baseline principle 21).

---

**Not proposed as CHECK, by design:**
- `action_code` (K07): the list is not approved, so this stays BLOCKED with no CHECK.
- State transitions (Q04): a CHECK cannot see the old value, so they are BACKEND.
- Cycles longer than one step (Q06): BACKEND.
- K04 lock, append-only and no-delete rules (Q07): BACKEND + PostgreSQL privileges, decided in Gate 3.
- No trigger, function, policy or extra index is proposed anywhere in this catalog.
