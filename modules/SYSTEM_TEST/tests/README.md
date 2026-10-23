# Unified module tests

From `backend/` after the module is staged in `modules/SYSTEM_TEST/` and dependencies installed:

`npx vitest run --config ../modules/SYSTEM_TEST/tests/vitest.config.mjs`

The bundled unit tests cover MIC mapping and TXT reports. They do **not** establish TEST DB/Host runtime acceptance.
The imported legacy test suites are under `legacy-tests-*/` for reference; they are NOT run by this config and require updating for v1.2.0.
