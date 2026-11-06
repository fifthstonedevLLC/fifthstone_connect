import { z } from 'zod';

/**
 * Runtime configuration, read once at startup. A missing or malformed value stops the process
 * with a message naming the variable, never its value.
 */
export const ConfigSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Seconds between passes when there is nothing to do. */
  WORKER_POLL_SECONDS: z.coerce.number().int().min(1).max(300).default(5),
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
