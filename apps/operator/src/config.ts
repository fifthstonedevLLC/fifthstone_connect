import { z } from 'zod';

/**
 * Operator configuration, read once per run. A missing or malformed value stops the command with
 * a message naming the variable, never its value. The service-role key is needed only to create
 * an owner's login, and only ever lives on the operator's machine (ADR-0003 decision 5).
 */
export const ConfigSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /** Which environment this machine's DATABASE_URL points at; see guard.ts. */
  OPERATOR_CONFIRM_ENV: z.enum(['development', 'staging', 'production']),
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  /** Where set-password links send people: the portal for this environment. */
  PORTAL_URL: z.url().default('http://127.0.0.1:5173'),
});

export type Config = z.output<typeof ConfigSchema>;

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid or missing configuration: ${names}`);
  }
  return parsed.data;
}
