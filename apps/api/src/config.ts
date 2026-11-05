import { z } from 'zod';

/**
 * Runtime configuration, read once at startup. A missing or malformed value stops the process
 * with a message naming the variable, never its value.
 */
export const ConfigSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /** Supabase project URL; sign-in tokens are verified against its published keys. */
  SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
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
