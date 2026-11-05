import type { FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type pg from 'pg';
import { withoutTenant } from './db.js';

/**
 * Portal sign-in. The browser signs in with Supabase Auth and sends the access token; the API
 * verifies it, then resolves the login to one active portal user and tenant. Everything after
 * that runs in that tenant's context.
 */

export interface PortalUser {
  portalUserId: string;
  tenantId: string;
  role: 'owner' | 'staff';
}

/** Verifies an access token and returns the Supabase Auth user ID, or null if invalid. */
export type TokenVerifier = (token: string) => Promise<string | null>;

export function supabaseTokenVerifier(supabaseUrl: string): TokenVerifier {
  const issuer = `${supabaseUrl.replace(/\/$/, '')}/auth/v1`;
  const keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, keys, { issuer, audience: 'authenticated' });
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    portalUser: PortalUser | null;
  }
}

/** preHandler for portal routes: 401 without a valid token, 403 without an active portal user. */
export function requirePortalUser(pool: pg.Pool, verify: TokenVerifier) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    const authUserId = token ? await verify(token) : null;
    if (!authUserId) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const resolved = await withoutTenant(pool, async (client) => {
      const { rows } = await client.query<{
        portal_user_id: string;
        tenant_id: string;
        role: 'owner' | 'staff';
      }>('select portal_user_id, tenant_id, role from app.resolve_portal_user($1)', [authUserId]);
      return rows[0];
    });
    if (!resolved) {
      // A valid login with no active portal user: disabled user or disabled tenant.
      return reply.code(403).send({ error: 'no_portal_access' });
    }
    request.portalUser = {
      portalUserId: resolved.portal_user_id,
      tenantId: resolved.tenant_id,
      role: resolved.role,
    };
  };
}
