import { createClient } from '@supabase/supabase-js';

/**
 * Supabase Auth in the browser: sign-in only. The portal never queries the database directly;
 * every read and write goes through apps/api. Only the public anon key is ever used here.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey || anonKey === 'CHANGE_ME') {
  throw new Error(
    'Portal configuration missing: copy apps/portal/.env.example to .env.local and fill it in.',
  );
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});
