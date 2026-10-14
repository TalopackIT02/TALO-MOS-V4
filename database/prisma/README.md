# Prisma mapping — IAM v0.3

`schema.prisma` maps the PostgreSQL schema `iam` created by
`database/sql/TALO-MOS-IAM-Security-PostgreSQL-v0.3.sql`. **The database is the source of truth.**
Prisma is used for introspection and as the query client only.

## Never run

`prisma migrate dev | deploy | reset`, `prisma db push`, or any SQL/DDL generated from a Prisma diff.
`database/prisma/migrations/` stays empty on purpose.

## Files

| File | Role |
|---|---|
| `database/prisma/schema.prisma` | Introspected models + the manual adjustments below (committed) |
| `backend/prisma.config.ts` | Schema path; `datasource.url` from `DATABASE_URL`; disables the CLI update check |
| `backend/src/infrastructure/prisma/generated/` | Output of `prisma generate` (git-ignored, regenerate locally) |
| `backend/src/infrastructure/prisma/client.ts` | The single place the application creates the Prisma client (pg driver adapter) |

Regenerate the client (no database needed): `cd backend` then `npm run prisma:generate`.

## Manual adjustments after introspection (decision F1.3 / O2)

`prisma db pull` (Prisma 7.10.0) automatically enables the preview feature `partialIndexes` and models the
partial unique index `uq_iam_membership_current_account` as `@unique`, which turns Membership → Account into a
1:1 relation. IAM v0.3 allows several accounts per membership over time (one current, others disabled), so the
schema is adjusted by hand:

1. Remove `previewFeatures = ["partialIndexes"]` from the generator block.
2. Remove the 5 partial-index declarations (lines containing `where: raw(`):
   - `@unique(map: "uq_iam_membership_current_account", where: ...)` on `iam_user_accounts.membership_id`
   - `@@unique(... map: "uq_iam_user_active_direct_permission", where: ...)`, `@@index(... map: "ix_iam_user_permission_account", where: ...)`
   - `@@unique(... map: "uq_iam_user_active_role", where: ...)`, `@@index(... map: "ix_iam_user_roles_account", where: ...)`
3. Make `iam_memberships.iam_user_accounts` a list: `iam_user_accounts iam_user_accounts[]` (1:N).

No model, table or column is renamed. Code must select the current account explicitly (`disabled_at: null`)
instead of relying on a unique relation.

## Constraints enforced by PostgreSQL but not represented in Prisma

| Kind | Name | Definition |
|---|---|---|
| Expression unique | `uq_iam_account_username` | `iam_user_accounts (lower(username))` |
| Expression unique | `uq_iam_role_code` | `iam_roles (lower(role_code))` |
| Expression unique | `uq_iam_permission_code` | `iam_permissions (lower(permission_code))` |
| Partial unique | `uq_iam_membership_current_account` | `iam_user_accounts (membership_id) WHERE disabled_at IS NULL` |
| Partial unique | `uq_iam_user_active_role` | `iam_user_roles (user_account_id, role_id) WHERE revoked_at IS NULL` |
| Partial unique | `uq_iam_user_active_direct_permission` | `iam_user_permissions (user_account_id, permission_id) WHERE revoked_at IS NULL` |
| Partial index | `ix_iam_user_roles_account` | `iam_user_roles (user_account_id) WHERE revoked_at IS NULL` |
| Partial index | `ix_iam_user_permission_account` | `iam_user_permissions (user_account_id) WHERE revoked_at IS NULL` |
| CHECK (12) | `ck_membership_status`, `ck_membership_dates`, `ck_account_status`, `ck_failed_count`, `ck_verification_status`, `ck_verification_expiry`, `ck_min_assurance`, `ck_grant_effect`, `ck_grant_expiry`, `ck_session_assurance`, `ck_session_expiry`, `ck_audit_outcome` | see the SQL file |
| Comments | all tables/columns | `COMMENT ON …` in the SQL file |

Because of the expression index, username lookups must use `lower(username) = lower($1)` (raw query) to match
the database's uniqueness rule and use the index.

## Re-introspection procedure (every time)

1. Snapshot the catalog read-only (tables, constraints, indexes, row counts) before and after.
2. Run with a read-only session and print only — never let Prisma write the file directly:
   `npx prisma db pull --print > <scratch>/introspected.prisma`
   (connection string with `options=-c default_transaction_read_only=on`; credentials only in the environment).
3. Diff `<scratch>/introspected.prisma` against `schema.prisma`; re-apply the three adjustments above.
4. Check cardinality: `iam_memberships.iam_user_accounts` must be a list; `npm run typecheck` runs the
   type-level cardinality test in `backend/test/unit/prisma-client.test.ts`.
5. `npm run prisma:validate`, `npm run prisma:generate`, `npm run typecheck`, `npm run build`, `npm test`.
6. Optional read-only catalog test: set `TALO_IAM_SCHEMA_CHECK=1` and `DATABASE_URL`, then
   `npx vitest run test/integration/iam-schema.readonly.test.ts`.
7. Have the diff reviewed before committing. Never use Prisma's drift output to change the database.
