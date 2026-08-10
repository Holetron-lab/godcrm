-- Rollback for phase6-6.1-bdd-research-log.sql.
-- WARNING: drops the table and all its rows. Research logs are not
-- recoverable without a prior pg_dump.
DROP TABLE IF EXISTS bdd_research_log;
