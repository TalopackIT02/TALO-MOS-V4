# PROTECTED SCOPE — TALO-MOS-V4

**Status:** Draft; User must approve and enforce technical controls.

| Scope | Default mode | Reason | Change route |
|---|---|---|---|
| `inputs/**` | READ ONLY | Original User assets | User edits; AI proposes separately |
| `database/**` | READ ONLY | SQL design & DB reference | Explicit schema/DB approval |
| `governance/**` | READ ONLY | Rules & platform decisions | Proposal → explicit User approval → User-controlled update |
| `.claude/**` | READ ONLY | Tool permission control | User-controlled update |
| `/CLAUDE.md` | READ ONLY | Root AI instructions | User-controlled update |
| `.github/workflows/**` | PROTECTED | CI/deployment effects | Separate User approval |
| `packages/contracts/**` | PROTECTED | API contract compatibility | Explicit API contract approval |
| `apps/**` | APPROVED-TASK ONLY | Product implementation | Listed in approved plan |
| `packages/**` except contracts | APPROVED-TASK ONLY | Shared code/config | Listed in approved plan |
| `design/**` | APPROVED-TASK ONLY | Working UX specs | User review/approval for baseline |
| `tests/**`, `scripts/**` | APPROVED-TASK ONLY | Validation/build scripts | Listed in approved plan |
| `claude/**` | CLAUDE ARTIFACT WRITING | Logs, drafts, reviews | Do not treat as auto-approval |

## Protected semantics even if file path is editable
- Business rules, finance/accounting calculations, access-control rules, session/auth behavior and approved workflow semantics.
- Database schema, migrations, production data and credentials.
- Public API contracts, runtime/framework/major dependencies and architecture decisions.
- Deployment and destructive Git/DB operations.

## Enforcement checklist (environment administrator)
- Run Claude in repository-scoped sandbox/user with only necessary filesystem grants.
- Use OS/ACL/container read-only mounts for original inputs and protected governance where practical.
- No production DB credentials; dedicated development user with minimal grants if needed.
- Set branch protection and CI checks; require review of diff.
- Configure `.claude/settings.json` based on installed Claude Code version; do not assume instruction text blocks OS access.
- Store secrets outside repository; rotate any accidentally exposed credentials.

## Exception handling
An exception requires exact paths, operations, rationale, validation, approver and time/task scope. Do not use a broad phrase such as “do whatever necessary” as permission for protected changes.
