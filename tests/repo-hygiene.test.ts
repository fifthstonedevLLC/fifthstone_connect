import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Guardrail tests: the secrets rules in CLAUDE.md are enforced, not just documented.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('repository hygiene', () => {
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
    const secretKeys = /(SECRET|PASSWORD|ACCESS_KEY|TOKEN)/;
    for (const line of lines) {
      const [key, ...rest] = line.split('=');
      const value = rest.join('=');
      if (key && secretKeys.test(key)) {
        expect(value, `${key} must be a placeholder`).toBe('CHANGE_ME');
      }
    }
    // No AWS access key IDs pasted anywhere.
    expect(read('.env.example')).not.toMatch(/AKIA[0-9A-Z]{16}/);
  });

  it('disables SES sending by default in the template', () => {
    expect(read('.env.example')).toMatch(/^SES_SEND_DISABLED=true$/m);
  });
});
