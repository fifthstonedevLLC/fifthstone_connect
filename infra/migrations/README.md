# Migrations

Versioned, forward-only SQL migrations for the Postgres schema (Phase 1).

- Naming: `NNNN_short_description.sql` (e.g. `0001_tenants_and_leads.sql`).
- Every tenant-owned table carries `tenant_id` and composite keys that prevent cross-tenant references.
- Each migration documents its rollback/restore approach in a header comment.
- Apply only to non-production databases until the owner approves production changes.
