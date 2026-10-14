-- TALO-MOS-V4 · Foundation F1 · 01 — create the isolated test database
-- STATUS: PREPARED, NOT EXECUTED. Requires a separate execution approval.
-- TARGET: cluster talo-mos-v4-postgres, connected to the maintenance database "postgres"
--         as a role allowed to create databases. Creates ONLY talo_mos_v4_test.
-- Does not touch talo_mos_v4_dev. Contains no DROP/TRUNCATE.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Abort: connect to the maintenance database "postgres" (currently connected to "%")', current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname = 'talo_mos_v4_test') THEN
    RAISE EXCEPTION 'Abort: database talo_mos_v4_test already exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolcreatedb)) THEN
    RAISE EXCEPTION 'Abort: role % cannot create databases', current_user;
  END IF;
END
$$;

-- Same encoding/locale as talo_mos_v4_dev (UTF8, en_US.utf8, libc) so test results match development.
CREATE DATABASE talo_mos_v4_test
  WITH TEMPLATE = template0
       ENCODING = 'UTF8'
       LOCALE_PROVIDER = 'libc'
       LC_COLLATE = 'en_US.utf8'
       LC_CTYPE = 'en_US.utf8';

-- Post-check
SELECT datname, pg_encoding_to_char(encoding) AS encoding, datcollate, datctype
FROM pg_database WHERE datname = 'talo_mos_v4_test';
