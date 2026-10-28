-- TALO-MOS-V4 · SCC 0.1.2 Foundation controlled read · 91 — drop the cluster role after 90 (connected to postgres)
-- STATUS: PROPOSAL FOR OWNER APPROVAL — NOT EXECUTED ON TEST. Run only after 90 succeeded on every database.
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talo_foundation_reader') THEN
    RAISE EXCEPTION 'Abort: talo_foundation_reader does not exist';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_shdepend WHERE refobjid = (SELECT oid FROM pg_roles WHERE rolname = 'talo_foundation_reader')) THEN
    RAISE EXCEPTION 'Abort: talo_foundation_reader still owns objects or holds privileges (run 90 first)';
  END IF;
END
$$;
DROP ROLE talo_foundation_reader;
