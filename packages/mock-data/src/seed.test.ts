import { readFileSync, readdirSync } from 'node:fs';
import { AiSettingsSchema, HOLD_STATES, LEAD_STATES, REQUEST_STATES } from '@fsc/core';
import { checkTemplateSet } from '@fsc/conversation';
import { describe, expect, it } from 'vitest';
import {
  CONTACTS,
  IGNORED_EVENTS,
  JOBS,
  LEADS,
  MockEmailSchema,
  MockPhoneSchema,
  PORTAL_USERS,
  SETTINGS_VERSIONS,
  TENANTS,
  buildSeedFiles,
} from './index.js';

const seedDir = new URL('../../../supabase/seed/', import.meta.url);

describe('mock catalog', () => {
  it('has unique keys, slugs, emails and phone numbers', () => {
    const unique = (values: string[]) => new Set(values).size === values.length;
    expect(unique(TENANTS.map((t) => t.key))).toBe(true);
    expect(unique(TENANTS.map((t) => t.slug))).toBe(true);
    expect(unique(PORTAL_USERS.map((u) => u.key))).toBe(true);
    expect(unique(PORTAL_USERS.map((u) => u.email))).toBe(true);
    expect(
      unique([
        ...TENANTS.flatMap((t) => (t.connectNumber ? [t.connectNumber] : [])),
        ...PORTAL_USERS.map((u) => u.mobile),
      ]),
    ).toBe(true);
  });

  it('gives every tenant exactly one owner, and every user a real tenant', () => {
    for (const tenant of TENANTS) {
      const owners = PORTAL_USERS.filter((u) => u.tenant === tenant.key && u.role === 'owner');
      expect(owners, tenant.key).toHaveLength(1);
    }
    const keys = new Set(TENANTS.map((t) => t.key));
    for (const user of PORTAL_USERS) expect(keys.has(user.tenant), user.key).toBe(true);
  });

  it('keeps every scenario inside its own tenant', () => {
    for (const lead of LEADS) {
      const contact = CONTACTS.find((c) => c.key === lead.contact);
      expect(contact?.tenant, `${lead.key} contact`).toBe(lead.tenant);
      const decider = lead.request?.decidedBy;
      if (decider) {
        expect(PORTAL_USERS.find((u) => u.key === decider)?.tenant, `${lead.key} approver`).toBe(
          lead.tenant,
        );
      }
    }
    const unique = (values: string[]) => new Set(values).size === values.length;
    expect(unique(LEADS.map((l) => l.key))).toBe(true);
    expect(unique(CONTACTS.map((c) => `${c.tenant}:${c.phone}`))).toBe(true);
    expect(unique(LEADS.flatMap((l) => (l.voicemail ? [l.voicemail.code] : [])))).toBe(true);
    // Messages in one thread never share a timestamp, so the thread order is always the same.
    for (const lead of LEADS) {
      expect(unique((lead.messages ?? []).map((m) => String(m.minutesAgo))), lead.key).toBe(true);
    }
  });

  // Restoring a seeded version runs the same checks as saving one, so every version must pass.
  it('seeds template and AI versions that pass the owner-edit rules', () => {
    for (const v of SETTINGS_VERSIONS) {
      const tenant = TENANTS.find((t) => t.key === v.tenant)!;
      const templates = Object.fromEntries(
        Object.entries(v.templates).map(([key, body]) => [
          key,
          body.replaceAll('{business}', tenant.name),
        ]),
      );
      const label = `${v.tenant} v${v.version}`;
      expect(checkTemplateSet(Object.keys(templates), templates, tenant.name), label).toMatchObject(
        {
          ok: true,
        },
      );
      expect(AiSettingsSchema.safeParse(v.ai).success, label).toBe(true);
    }
  });

  it('covers every lead, request and hold state (MOCK_DATA.md acceptance check)', () => {
    const seen = (values: (string | undefined)[]) => new Set(values);
    const leads = seen(LEADS.map((l) => l.state));
    const requests = seen(LEADS.map((l) => l.request?.state));
    const holds = seen(LEADS.map((l) => l.request?.hold));
    expect(LEAD_STATES.filter((s) => !leads.has(s))).toEqual([]);
    expect(REQUEST_STATES.filter((s) => !requests.has(s))).toEqual([]);
    expect(HOLD_STATES.filter((s) => !holds.has(s))).toEqual([]);
  });

  it('gives every tenant past onboarding leads in its own playbook', () => {
    for (const tenant of TENANTS.filter((t) => t.status !== 'onboarding')) {
      expect(LEADS.filter((l) => l.tenant === tenant.key).length, tenant.key).toBeGreaterThan(0);
    }
  });

  // Old Mill was disabled 30,000 minutes before load (12_audit_events.sql).
  it('creates nothing for a disabled tenant after it was disabled, except ignored events', () => {
    const disabled = new Set(TENANTS.filter((t) => t.status === 'disabled').map((t) => t.key));
    const DISABLED_MINUTES_AGO = 30000;
    for (const lead of LEADS.filter((l) => disabled.has(l.tenant))) {
      expect(lead.minutesAgo, lead.key).toBeGreaterThan(DISABLED_MINUTES_AGO);
    }
    for (const job of JOBS.filter((j) =>
      disabled.has(LEADS.find((l) => l.key === j.lead)!.tenant),
    )) {
      expect(-job.runInMinutes, `${job.lead} ${job.action}`).toBeGreaterThan(DISABLED_MINUTES_AGO);
    }
    expect(IGNORED_EVENTS.every((e) => disabled.has(e.tenant))).toBe(true);
  });

  it('shares phone numbers across tenants only as separate contacts (X-07)', () => {
    const tenantsFor = (phone: string) =>
      CONTACTS.filter((c) => c.phone === phone).map((c) => c.tenant);
    expect(tenantsFor('+13195550120')).toEqual(['T1', 'T2']);
  });

  it('rejects real-looking phone numbers and email addresses', () => {
    expect(MockPhoneSchema.safeParse('+13195550199').success).toBe(true);
    expect(MockPhoneSchema.safeParse('+13195550200').success).toBe(false);
    expect(MockPhoneSchema.safeParse('(319) 555-0150').success).toBe(false);
    expect(MockEmailSchema.safeParse('owner@riverbend.example.com').success).toBe(true);
    expect(MockEmailSchema.safeParse('owner@gmail.com').success).toBe(false);
    expect(MockEmailSchema.safeParse('x@example.com.evil.net').success).toBe(false);
  });
});

describe('supabase/seed', () => {
  const files = buildSeedFiles();

  it('is up to date with the catalog (run `npm run seed:build` if this fails)', () => {
    const onDisk = readdirSync(seedDir).filter((f) => f.endsWith('.sql'));
    expect(onDisk.sort()).toEqual([...files.keys()].sort());
    for (const [name, contents] of files) {
      const disk = readFileSync(new URL(name, seedDir), 'utf8').replaceAll('\r\n', '\n');
      expect(disk, name).toBe(contents);
    }
  });

  it('is deterministic', () => {
    expect(buildSeedFiles()).toEqual(files);
  });
});
