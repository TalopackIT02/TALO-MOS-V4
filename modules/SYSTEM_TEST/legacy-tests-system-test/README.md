Source-level Vitest tests (run under TALO backend's installed dependencies):

    cd backend
    npm run modules:sync
    npx vitest run --config ../modules/SYSTEM_TEST/tests/vitest.config.mjs

Tests here use synthetic facts; actual integration requires existing Host/Foundation runtime checks on TEST. No database writes or SQL GRANT.
