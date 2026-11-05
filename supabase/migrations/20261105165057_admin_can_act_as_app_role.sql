-- Purpose: Let the admin role (`postgres`) act as the application role. apps/api and apps/worker
--          run every tenant transaction with `set local role fsc_app`, so even a connection made
--          as `postgres` (local development, the operator's direct connection) is held to the
--          application's privileges and row-level security for tenant work.
-- Tables: none (role membership only)
-- Rollback: `revoke fsc_app from postgres` in a superseding migration.
-- Ref: ADR-0003 decision 6; DATABASE.md connection rules.

grant fsc_app to postgres;
