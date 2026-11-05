import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MockEmailSchema,
  MockPhoneSchema,
  PORTAL_USERS,
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
      unique([...TENANTS.map((t) => t.connectNumber), ...PORTAL_USERS.map((u) => u.mobile)]),
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
