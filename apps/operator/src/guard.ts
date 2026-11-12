/**
 * Guards against running a command on the wrong database or with the wrong kind of data
 * (ADR-0003 decision 5; CLAUDE.md rule 17). `OPERATOR_CONFIRM_ENV` names where this machine's
 * DATABASE_URL points:
 * - development: only mock businesses (`mock-` slugs), example.com/.org/.net emails and
 *   555-0100 to 555-0199 numbers;
 * - staging and production: every change needs `--confirm <environment>`, typed out;
 * - production: never a `mock-` business.
 */

export type OperatorEnv = 'development' | 'staging' | 'production';

export interface GuardInput {
  env: OperatorEnv;
  /** What the command would change; read-only commands pass nothing. */
  slug?: string;
  email?: string;
  number?: string;
  confirm?: string;
}

const MOCK_EMAIL = /@(?:[a-z0-9-]+\.)*example\.(?:com|org|net)$/;
const MOCK_NUMBER = /^\+1\d{3}55501\d{2}$/;

/** Problems that stop a changing command; empty when it may run. */
export function guardProblems(input: GuardInput): string[] {
  const problems: string[] = [];
  const mockSlug = input.slug?.startsWith('mock-') ?? false;
  if (input.env === 'development') {
    if (input.slug !== undefined && !mockSlug) {
      problems.push('development holds mock businesses only: the slug must start with mock-');
    }
    if (input.email !== undefined && !MOCK_EMAIL.test(input.email)) {
      problems.push('development emails must use example.com, .org or .net');
    }
    if (input.number !== undefined && !MOCK_NUMBER.test(input.number)) {
      problems.push('development numbers must be in 555-0100 to 555-0199');
    }
    return problems;
  }
  if (input.confirm !== input.env) {
    problems.push(`changes on ${input.env} need --confirm ${input.env}`);
  }
  if (input.env === 'production' && mockSlug) {
    problems.push('production never holds mock- businesses');
  }
  return problems;
}
