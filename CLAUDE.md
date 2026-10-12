# CLAUDE CODE — TALO-MOS-V4

## Mandatory preflight
1. Read `governance/CLAUDE_CODE_LAW.md`.
2. Read `governance/PROTECTED_SCOPE.md`.
3. Read `governance/TECHNOLOGY_REGISTRY.md`.
4. Read `governance/ARCHITECTURE.md`.
5. Read the relevant task plan and supporting inputs/contracts.

If mandatory policy files are missing or ambiguous, do **not** implement. Return `BLOCKED` / `DECISION_REQUIRED`.

## Default access
- READ ONLY: `inputs/`, `database/`, `governance/`, `.claude/`, `CLAUDE.md`, CI config.
- TASK APPROVAL REQUIRED: `apps/`, `packages/`, `design/`, `tests/`, `scripts/`.
- ARTIFACT WRITING: `claude/plans/`, `claude/proposals/`, `claude/reports/`, `claude/reviews/`, `claude/handoffs/`.
- Do not read/write outside repository.

## Mandatory workflow
READ → ANALYZE → DRAFT PLAN → EXPLICIT USER APPROVAL → IMPLEMENT → VALIDATE → REPORT → HANDOFF.

Never silently alter business rules, SQL schemas, API contracts, architecture, framework, critical dependencies or protected paths. Do not claim a test passed unless it ran. Record source file changes and dependencies in report. Use proposals for out-of-scope changes. A draft plan or presence of an input file is not approval.

**Notes:** This document does not create OS/security isolation. Configure filesystem, credentials, database grants, Git protection and Claude Code permissions outside this file.
