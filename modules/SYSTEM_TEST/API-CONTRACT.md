# API contracts — unified SYSTEM_TEST 1.2.0

All endpoints are rooted at `/api` and require the Host session/IAM/lifecycle gate. They do not grant SQL privileges, write data, or run shell commands.

| Method | Endpoint | Envelope | MIC function/action |
|---|---|---|---|
| GET | `/system-test/health` | `{ "health": ... }` | DIAGNOSTICS.READ |
| POST | `/system-test/checks/run` | `{ "run": ... }` | DIAGNOSTICS.READ |
| GET | `/system-test/results` | `{ "results": ... }` | TEST_RUNNER.EXECUTE |
| GET | `/system-test/data/tables` | `{ "scope": ..., "tables": ..., "catalogComplete": ... }` | CATALOG.READ |
| GET | `/system-test/data/tables/:tableKey/columns` | Table metadata + `columns` | CATALOG.READ |
| GET | `/system-test/data/tables/:tableKey/rows` | Bounded table page | ROWS.READ |
| GET | `/system-test/audit/logs` | `{ "logs": ... }` | AUDIT_LOG.READ |

## Audit query parameters (all optional)

- `source`: `ALL` (default), `FOUNDATION`, `IAM`.
- `outcome`: `ISSUES` for FAILURE or DENIED; `ALL`, `SUCCESS`, `FAILURE`, `DENIED`. Default `ALL` in the raw API; UI defaults `ISSUES`.
- `action`: up to 80 characters, only letters/numbers/dot/underscore/hyphen; substring match.
- `actorAccountId`: UUID, uses bound SQL parameter.
- `from`, `to`: offset-aware ISO 8601 timestamps; default last 24 hours; maximum span 31 days.
- `page`: 1..10 (default 1), `pageSize`: 1..50 (default 25).

Sample response:

```json
{
  "logs": {
    "scope": "RECORDED_AUDIT_ONLY",
    "queriedAt": "2026-10-23T00:00:00Z",
    "from": "2026-10-22T00:00:00Z",
    "to": "2026-10-23T00:00:00Z",
    "page": 1,
    "pageSize": 25,
    "hasNext": false,
    "complete": false,
    "sources": {
      "FOUNDATION": {"state":"UNAVAILABLE", "sqlstate":"42501"},
      "IAM": {"state":"AVAILABLE"}
    },
    "events": []
  }
}
```

Values above are illustrative only, not actual DB readings. `complete:false` means a source failed and the event list cannot be taken as exhaustive.

Errors are in the Host/Foundation envelope: `{"error":{"code":"...","message":"...","requestId":"..."}}`.

## Audit data deliberately not returned

- Raw `metadata` JSON, before/after state, session token, passwords, credentials.
- Uninstrumented runtime exceptions or HTTP requests for which no B08/IAM audit exists.

The UI shows action code, outcome, time, username (when accessible), account id, target, reason/error code only when safe, and source availability.
