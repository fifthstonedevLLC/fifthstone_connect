import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Guardrail tests: the rules in CLAUDE.md and docs/engineering/DATABASE.md are enforced, not just
// documented.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const exists = (path: string) => existsSync(new URL(`../${path}`, import.meta.url));
const list = (path: string) =>
  exists(path) ? readdirSync(new URL(`../${path}/`, import.meta.url)) : [];

// Directories never scanned: dependencies, VCS data, build output, and the Supabase CLI's own
// git-ignored local state.
const SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'supabase/.temp',
  'supabase/.branches',
]);

/** Every tracked-looking file in the repo, as a posix path relative to the root. */
function walk(dir = ''): string[] {
  const entries = readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true });
  return entries.flatMap((entry) => {
    const rel = dir ? `${dir}${entry.name}` : entry.name;
    if (SKIP.has(rel) || SKIP.has(entry.name)) return [];
    return entry.isDirectory() ? walk(`${rel}/`) : [rel];
  });
}

const files = walk();
const name = (path: string) => path.split('/').pop() ?? path;

describe('repository hygiene: secrets', () => {
  it('ignores real env files but keeps the template', () => {
    const gitignore = read('.gitignore').split(/\r?\n/);
    expect(gitignore).toContain('.env');
    expect(gitignore).toContain('.env.*');
    expect(gitignore).toContain('!.env.example');
  });

  it('keeps .env.example free of real-looking secrets', () => {
    const lines = read('.env.example')
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith('#'));
    const secretKeys = /(SECRET|PASSWORD|ACCESS_KEY|TOKEN|_KEY$)/;
    for (const line of lines) {
      const [key, ...rest] = line.split('=');
      const value = rest.join('=');
      if (key && secretKeys.test(key)) {
        expect(value, `${key} must be a placeholder`).toBe('CHANGE_ME');
      }
    }
    // No AWS access key IDs or Supabase JWTs pasted anywhere.
    expect(read('.env.example')).not.toMatch(/AKIA[0-9A-Z]{16}/);
    expect(read('.env.example')).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
  });

  it('disables SES sending by default in the template', () => {
    expect(read('.env.example')).toMatch(/^SES_SEND_DISABLED=true$/m);
  });
});

describe('repository hygiene: no stray files', () => {
  it('has no scratch, temporary, cleanup, backup or work-in-progress files', () => {
    const stray =
      /(^|[._-])(tmp|temp|scratch|cleanup|clean-up|teardown|wip|backup|bak|old|copy|debug|draft)([._-]|$)/i;
    const strayExt = /\.(bak|orig|rej|swp|tmp)$/i;
    const offenders = files.filter((f) => stray.test(name(f)) || strayExt.test(f));
    expect(offenders).toEqual([]);
  });

  it('has no shell or one-off script files', () => {
    const offenders = files.filter((f) => /\.(sh|ps1|bat|cmd|py|rb|pl)$/i.test(f));
    expect(offenders).toEqual([]);
  });

  it('keeps JavaScript to the allowlisted config and preview files', () => {
    const allowed = new Set(['eslint.config.js', 'apps/marketing/serve.mjs']);
    const offenders = files.filter((f) => /\.(js|mjs|cjs)$/.test(f) && !allowed.has(f));
    expect(offenders).toEqual([]);
  });

  it('keeps TypeScript inside package and app sources, tests, or the test config', () => {
    const offenders = files.filter(
      (f) =>
        f.endsWith('.ts') &&
        f !== 'vitest.config.ts' &&
        !/^(packages|apps)\/[^/]+\/src\//.test(f) &&
        !f.startsWith('tests/'),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps every SQL file inside supabase/', () => {
    const offenders = files.filter((f) => f.endsWith('.sql') && !f.startsWith('supabase/'));
    expect(offenders).toEqual([]);
  });
});

describe('repository hygiene: supabase layout', () => {
  it('holds only config, migrations, seed and tests', () => {
    const allowed = new Set(['config.toml', '.gitignore', 'migrations', 'seed', 'tests']);
    const ignored = new Set(['.temp', '.branches']);
    const offenders = list('supabase').filter((e) => !allowed.has(e) && !ignored.has(e));
    expect(offenders).toEqual([]);
  });

  const migrations = list('supabase/migrations');

  it('names migrations <14-digit timestamp>_<snake_case>.sql and nothing else', () => {
    const offenders = migrations.filter((f) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(f));
    expect(offenders).toEqual([]);
  });

  it('starts every migration with the required header', () => {
    for (const file of migrations) {
      const head = read(`supabase/migrations/${file}`).split(/\r?\n/).slice(0, 12).join('\n');
      for (const field of ['-- Purpose:', '-- Tables:', '-- Rollback:', '-- Ref:']) {
        expect(head, `${file} is missing "${field}"`).toContain(field);
      }
    }
  });

  it('records every migration in the ledger, and only real ones', () => {
    const ledger = read('docs/engineering/MIGRATION_LEDGER.md');
    const rows = [...ledger.matchAll(/^\|\s*`?(\d{14}_[a-z0-9_]+\.sql)`?\s*\|/gm)].map((m) => m[1]);
    expect([...rows].sort()).toEqual([...migrations].sort());
  });

  it('names seed files NN_<snake_case>.sql and tests <name>.test.sql', () => {
    expect(list('supabase/seed').filter((f) => !/^\d{2}_[a-z0-9_]+\.sql$/.test(f))).toEqual([]);
    expect(list('supabase/tests').filter((f) => !/^[a-z0-9_]+\.test\.sql$/.test(f))).toEqual([]);
  });

  it('keeps seed data to fictional phone numbers and reserved email domains', () => {
    const phone = /\+1\d{3}(\d{3})(\d{4})\b|\(\d{3}\)\s?(\d{3})-(\d{4})|\b\d{3}-(\d{3})-(\d{4})\b/g;
    const email = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
    const reserved = /(^|\.)example\.(com|org|net)$/i;
    for (const file of list('supabase/seed')) {
      const sql = read(`supabase/seed/${file}`);
      for (const m of sql.matchAll(phone)) {
        const exchange = m[1] ?? m[3] ?? m[5];
        const line = m[2] ?? m[4] ?? m[6];
        expect(`${exchange}-${line}`, `${file}: ${m[0]} is not 555-01XX`).toMatch(/^555-01\d\d$/);
      }
      for (const m of sql.matchAll(email)) {
        expect(m[1], `${file}: ${m[0]} is not a reserved domain`).toMatch(reserved);
      }
    }
  });
});
