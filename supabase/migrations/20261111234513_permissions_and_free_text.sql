-- Purpose: Permissions the owner sets, and the owner's switch for free-text replies (decisions 39
--          and 40). Staff hold the capabilities the owner grants (they start with what decisions
--          25 to 27 gave them: acting on leads and template replies); the owner holds all.
--          Free text is off on every channel until the owner turns it on.
-- Tables: app.tenant_config (adds staff_capabilities, free_text_channels)
-- Rollback: Local only so far (`npm run db:reset`). Once pushed, a superseding migration drops
--           both columns.
-- Ref: decisions 39 and 40 (DECISIONS_PENDING.md); packages/core/src/permissions.ts.

-- The capability names match @fsc/core's CAPABILITIES; a new capability needs a migration too.
alter table app.tenant_config
  add column staff_capabilities text[] not null default '{act_on_leads,reply_templates}'
    check (staff_capabilities <@ array['act_on_leads', 'reply_templates', 'reply_free_text',
                                       'edit_templates']),
  -- Channels where people allowed to may type their own replies; `sms` is the only one so far.
  add column free_text_channels text[] not null default '{}'
    check (free_text_channels <@ array['sms']);

-- The owner changes both in Settings; apps/api checks the owner before writing.
grant update (staff_capabilities, free_text_channels) on app.tenant_config to fsc_app;
