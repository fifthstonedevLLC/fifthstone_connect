# Deployment

Plan: [ADR-0003](../../docs/adr/0003-database-platform-and-hosting.md) and the hosting section of
[SYSTEM_OVERVIEW.md](../../docs/architecture/SYSTEM_OVERVIEW.md). `apps/api`, `apps/worker`
and `apps/portal` run as containers on the Hostinger VPS under Dokploy, connected to hosted
Supabase projects for staging and production.

Nothing is provisioned yet. No infrastructure, DNS or Supabase project is created without owner
approval.
