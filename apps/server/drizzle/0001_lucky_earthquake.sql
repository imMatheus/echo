-- Drizzle records this lightweight transactional marker first. The startup
-- migration runner then performs legacy cleanup in bounded autocommit batches
-- and installs the indexes represented by this migration's snapshot with
-- CREATE/DROP INDEX CONCURRENTLY. Its separate completion marker makes that
-- phase safe to retry after a crash.
SELECT 1;
