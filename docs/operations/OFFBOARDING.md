---
title: 'Tenant Offboarding'
product: 'Fifth Stone Connect'
organization: 'Fifth Stone Dev'
status: 'Draft'
version: '0.1'
owner: 'Fifth Stone Dev'
last_updated: '2026-11-02'
---

# Tenant Offboarding

Procedure when a business ends service or requests deletion. Draft.

1. Disable tenant (stops intake and pending jobs).
2. Export tenant data if requested; deliver securely.
3. Remove SES identity (or sending authorization) for the tenant's domain.
4. Ask customer to un-share the Google Sheet from the service account; remove stored Sheet ID.
5. Rotate any per-tenant webhook secrets; remove embed instructions.
6. Delete tenant data per contract retention terms; confirm deletion in writing.
7. Log the offboarding in `audit_events` and note it in the changelog.
