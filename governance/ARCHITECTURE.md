# ARCHITECTURE BASELINE — TALO-MOS-V4

**Status:** NOT_DEFINED (draft template). No framework or topology has been approved.

## Confirmed repository-level decisions
- Single repository named `TALO-MOS-V4` combining deployable WebApp code, original User input, design, AI reports and governance.
- `apps/web/` and `apps/api/` are provisional frontend/backend areas.
- SQL in `database/design/` is reference material and read-only to Claude.
- Approved business logic and data contracts cannot be changed without User approval.

## Decisions awaiting User approval
| Decision | Current value | Owner |
|---|---|---|
| Frontend framework/version | TBD | User |
| Backend framework/version | TBD | User |
| Programming language/runtime | TBD | User |
| One backend or BFF/external integration | TBD | User |
| API contract/protocol | TBD | User |
| Auth/session/authorization strategy | TBD | User |
| Database engine and environments | TBD | User |
| UI library and design tokens | TBD | User |
| Build/package manager | TBD | User |
| Testing strategy/CI | TBD | User |
| Deployment environments | TBD | User |

## Rules
- Provisional folder names are not a mandate to instantiate any framework.
- Before generating runnable application bootstrap files, approve at least the relevant technology baseline, runtime/package management, app entry points and test/build acceptance criteria.
- Design changes alone must not silently become domain/schema changes.
- Proposed architecture changes go to `claude/proposals/` pending approval.
