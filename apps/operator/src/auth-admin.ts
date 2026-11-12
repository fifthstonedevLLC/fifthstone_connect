/**
 * Owner logins, through Supabase Auth's admin API (server-side, service-role key, operator
 * machine only; ADR-0003 decision 5). No email is sent from here: the operator gets a
 * set-password link to pass on themselves, so nothing reaches a real inbox without them.
 */
export interface AuthAdmin {
  /** The login's ID, creating the login (email confirmed, no password yet) if it is new. */
  ensureUser(email: string): Promise<string>;
  /** A one-time link where the owner sets their password. */
  setPasswordLink(email: string): Promise<string>;
}

export function supabaseAuthAdmin(
  supabaseUrl: string,
  serviceRoleKey: string,
  lookup: (email: string) => Promise<string | null>,
  /** The portal, where the link lands and asks for a new password. */
  portalUrl: string,
): AuthAdmin {
  const base = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/admin`;
  const headers = {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    'content-type': 'application/json',
  };
  return {
    async ensureUser(email) {
      const existing = await lookup(email);
      if (existing) return existing;
      const res = await fetch(`${base}/users`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email, email_confirm: true }),
      });
      if (!res.ok) throw new Error(`Supabase Auth refused the new login (${res.status})`);
      const body = (await res.json()) as { id?: unknown };
      if (typeof body.id !== 'string') throw new Error('Supabase Auth returned no login ID');
      return body.id;
    },
    async setPasswordLink(email) {
      const res = await fetch(`${base}/generate_link`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ type: 'recovery', email, redirect_to: portalUrl }),
      });
      if (!res.ok) throw new Error(`Supabase Auth refused the password link (${res.status})`);
      const body = (await res.json()) as { action_link?: unknown; properties?: unknown };
      const link =
        typeof body.action_link === 'string'
          ? body.action_link
          : (body.properties as { action_link?: unknown } | undefined)?.action_link;
      if (typeof link !== 'string') throw new Error('Supabase Auth returned no password link');
      return link;
    },
  };
}
