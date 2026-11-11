import { AiSettingsSchema, type AiSettings } from '@fsc/core';
import { checkTemplateSet, type TemplateProblem } from '@fsc/conversation';
import type { DbClient } from '../db.js';

/**
 * Versioned templates and AI settings (SCOPE.md v0.2, "Settings the owner controls"). Runs inside
 * `withTenant`. Every save writes a new version and makes it the live one; old versions never
 * change, so undo is making an earlier version live again. Every save and restore is an audit
 * event. The rules for what may be saved live in @fsc/conversation and @fsc/core and are checked
 * here, server-side, before anything is written (CLAUDE.md rule 11).
 */

export const SETTINGS_KINDS = ['templates', 'ai'] as const;
export type SettingsKind = (typeof SETTINGS_KINDS)[number];

const TABLE: Record<SettingsKind, string> = {
  templates: 'app.tenant_templates',
  ai: 'app.ai_settings',
};
const SUBJECT: Record<SettingsKind, string> = { templates: 'tenant_templates', ai: 'ai_settings' };

/** Versions listed in the history; older ones stay in the database. */
const HISTORY_LIMIT = 20;

export interface SettingsVersion<T> {
  version: number;
  active: boolean;
  createdAt: string;
  createdByName: string | null;
  content: T;
}

export interface Settings {
  canEdit: boolean;
  businessName: string;
  templates: { versions: SettingsVersion<Record<string, string>>[] };
  ai: { versions: SettingsVersion<AiSettings>[] };
}

export type SettingsError =
  'not_found' | 'stale_version' | 'template_keys_changed' | 'version_breaks_rules';

export type WriteResult =
  | { ok: true }
  | { ok: false; error: SettingsError }
  | {
      ok: false;
      error: 'template_problems';
      problems: { key: string; problems: TemplateProblem[] }[];
    };

async function businessNameOf(client: DbClient, tenantId: string): Promise<string> {
  const { rows } = await client.query<{ name: string }>(
    `select name from app.tenants where id = $1`,
    [tenantId],
  );
  const row = rows[0];
  if (!row) throw new Error('tenant not visible in its own context');
  return row.name;
}

async function versions(
  client: DbClient,
  tenantId: string,
  kind: SettingsKind,
): Promise<SettingsVersion<Record<string, unknown>>[]> {
  // The live version is always listed, however old it is.
  const { rows } = await client.query<{
    version: number;
    active: boolean;
    created_at: Date;
    content: Record<string, unknown>;
    created_by_name: string | null;
  }>(
    `select v.version, v.active, v.created_at, v.content, pu.display_name as created_by_name
       from ${TABLE[kind]} v
       left join app.portal_users pu on pu.tenant_id = v.tenant_id and pu.id = v.created_by
      where v.tenant_id = $1
      order by v.active desc, v.version desc
      limit ${HISTORY_LIMIT}`,
    [tenantId],
  );
  return rows
    .map((r) => ({
      version: r.version,
      active: r.active,
      createdAt: r.created_at.toISOString(),
      createdByName: r.created_by_name,
      content: r.content,
    }))
    .sort((a, b) => b.version - a.version);
}

export async function getSettings(
  client: DbClient,
  tenantId: string,
  role: 'owner' | 'staff',
): Promise<Settings> {
  const businessName = await businessNameOf(client, tenantId);
  const templates = (await versions(client, tenantId, 'templates')) as SettingsVersion<
    Record<string, string>
  >[];
  const ai = (await versions(client, tenantId, 'ai')).map((v) => ({
    ...v,
    content: AiSettingsSchema.parse(v.content),
  }));
  return {
    canEdit: role === 'owner',
    businessName,
    templates: { versions: templates },
    ai: { versions: ai },
  };
}

/** Locks the live version so two saves cannot both build on it. */
async function lockActive(
  client: DbClient,
  tenantId: string,
  kind: SettingsKind,
): Promise<{ version: number; content: Record<string, unknown> } | null> {
  const { rows } = await client.query<{ version: number; content: Record<string, unknown> }>(
    `select version, content from ${TABLE[kind]} where tenant_id = $1 and active for update`,
    [tenantId],
  );
  return rows[0] ?? null;
}

function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort();
}

async function audit(
  client: DbClient,
  tenantId: string,
  portalUserId: string,
  action: string,
  kind: SettingsKind,
  subjectId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `insert into app.audit_events
       (tenant_id, actor_type, actor_portal_user_id, action, subject_type, subject_id, detail)
     values ($1, 'portal_user', $2, $3, $4, $5, $6)`,
    [tenantId, portalUserId, action, SUBJECT[kind], subjectId, JSON.stringify(detail)],
  );
}

/**
 * Saves a new version built on `baseVersion`, the version the editor started from. If someone
 * else saved or restored since, nothing is written (`stale_version`). The client supplies the
 * version's ID, so a repeated submit writes one version. Saving unchanged wording writes nothing.
 */
export async function saveSettings(
  client: DbClient,
  tenantId: string,
  portalUserId: string,
  kind: SettingsKind,
  input: { id: string; baseVersion: number | null; content: Record<string, unknown> },
): Promise<WriteResult> {
  const businessName = await businessNameOf(client, tenantId);

  const existing = await client.query(
    `select 1 from ${TABLE[kind]} where tenant_id = $1 and id = $2`,
    [tenantId, input.id],
  );
  if (existing.rowCount) return { ok: true };

  const active = await lockActive(client, tenantId, kind);
  if ((active?.version ?? null) !== input.baseVersion) return { ok: false, error: 'stale_version' };

  let content: Record<string, unknown>;
  if (kind === 'templates') {
    const checked = checkTemplateSet(
      Object.keys(active?.content ?? {}),
      input.content as Record<string, string>,
      businessName,
    );
    if (!checked.ok) return checked;
    content = checked.content;
  } else {
    content = AiSettingsSchema.parse(input.content);
  }

  const changed = changedKeys(active?.content ?? {}, content);
  if (changed.length === 0) return { ok: true };

  await client.query(`update ${TABLE[kind]} set active = false where tenant_id = $1 and active`, [
    tenantId,
  ]);
  const inserted = await client.query<{ version: number }>(
    `insert into ${TABLE[kind]} (id, tenant_id, version, content, active, created_by)
     select $2, $1, coalesce(max(version), 0) + 1, $3, true, $4
       from ${TABLE[kind]} where tenant_id = $1
     returning version`,
    [tenantId, input.id, JSON.stringify(content), portalUserId],
  );
  await audit(client, tenantId, portalUserId, `settings.${kind}_saved`, kind, input.id, {
    version: inserted.rows[0]?.version,
    previousVersion: active?.version ?? null,
    changed,
  });
  return { ok: true };
}

/**
 * Makes an earlier version live again. Restoring the version that is already live is a no-op, so
 * a repeated click is harmless. A version that no longer passes today's rules is not restored.
 */
export async function restoreSettings(
  client: DbClient,
  tenantId: string,
  portalUserId: string,
  kind: SettingsKind,
  input: { version: number; baseVersion: number | null },
): Promise<WriteResult> {
  const businessName = await businessNameOf(client, tenantId);

  const active = await lockActive(client, tenantId, kind);
  if (active?.version === input.version) return { ok: true };
  if ((active?.version ?? null) !== input.baseVersion) return { ok: false, error: 'stale_version' };

  const target = await client.query<{ id: string; content: Record<string, unknown> }>(
    `select id, content from ${TABLE[kind]} where tenant_id = $1 and version = $2`,
    [tenantId, input.version],
  );
  const row = target.rows[0];
  if (!row) return { ok: false, error: 'not_found' };

  const passes =
    kind === 'templates'
      ? checkTemplateSet(
          Object.keys(row.content),
          row.content as Record<string, string>,
          businessName,
        ).ok
      : AiSettingsSchema.safeParse(row.content).success;
  if (!passes) return { ok: false, error: 'version_breaks_rules' };

  await client.query(`update ${TABLE[kind]} set active = false where tenant_id = $1 and active`, [
    tenantId,
  ]);
  await client.query(`update ${TABLE[kind]} set active = true where tenant_id = $1 and id = $2`, [
    tenantId,
    row.id,
  ]);
  await audit(client, tenantId, portalUserId, `settings.${kind}_restored`, kind, row.id, {
    version: input.version,
    previousVersion: active?.version ?? null,
  });
  return { ok: true };
}

/**
 * Makes a starter version live when the owner picks a business type (decision 34). The starter
 * set replaces the live one as a new version, so the owner's earlier wording stays in the history
 * and can be restored. Wording that is already live writes nothing. Starter templates pass the
 * same rules as an owner's save, checked with this business's name.
 */
export async function applyStarterSettings(
  client: DbClient,
  tenantId: string,
  portalUserId: string,
  kind: SettingsKind,
  starter: Record<string, unknown>,
  reason: { workflow: string; trade: string },
): Promise<
  | { ok: true; version: number | null }
  | {
      ok: false;
      error: 'template_problems';
      problems: { key: string; problems: TemplateProblem[] }[];
    }
> {
  const businessName = await businessNameOf(client, tenantId);
  let content: Record<string, unknown>;
  if (kind === 'templates') {
    const strings = starter as Record<string, string>;
    const checked = checkTemplateSet(Object.keys(strings), strings, businessName);
    if (!checked.ok) {
      if (checked.error === 'template_problems') return checked;
      throw new Error('starter template keys are inconsistent');
    }
    content = checked.content;
  } else {
    content = AiSettingsSchema.parse(starter);
  }

  const active = await lockActive(client, tenantId, kind);
  if (active && changedKeys(active.content, content).length === 0)
    return { ok: true, version: null };

  await client.query(`update ${TABLE[kind]} set active = false where tenant_id = $1 and active`, [
    tenantId,
  ]);
  const inserted = await client.query<{ id: string; version: number }>(
    `insert into ${TABLE[kind]} (tenant_id, version, content, active, created_by)
     select $1, coalesce(max(version), 0) + 1, $2, true, $3
       from ${TABLE[kind]} where tenant_id = $1
     returning id, version`,
    [tenantId, JSON.stringify(content), portalUserId],
  );
  const row = inserted.rows[0]!;
  await audit(client, tenantId, portalUserId, `settings.${kind}_starter_applied`, kind, row.id, {
    version: row.version,
    previousVersion: active?.version ?? null,
    ...reason,
  });
  return { ok: true, version: row.version };
}
