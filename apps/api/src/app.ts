import { LEAD_STATES, SERVICE_REGISTRATION_STATES, URGENCIES } from '@fsc/core';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type pg from 'pg';
import { z } from 'zod';
import { requirePortalUser, type TokenVerifier } from './auth.js';
import { withTenant } from './db.js';
import { getMe } from './repositories/me.js';
import { getToday } from './repositories/today.js';

/**
 * The HTTP app. Routes are thin: validate input with Zod, call a repository or package function
 * inside the right tenant context, return output that is validated on the way out too.
 */

export interface AppDeps {
  pool: pg.Pool;
  verifyToken: TokenVerifier;
  logger?: FastifyServerOptions['logger'];
}

/**
 * Logs never carry tokens or customer details (CLAUDE.md rule 4). Request logs hold method, URL
 * and status only; these paths are censored wherever they appear.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.phone',
  '*.email',
  '*.body',
  '*.summary',
  '*.transcript',
];

const ErrorSchema = z.object({ error: z.string() });

const LeadCardSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  summary: z.string().nullable(),
  state: z.enum(LEAD_STATES),
  reason: z.string().nullable(),
  urgency: z.enum(URGENCIES).nullable(),
  createdAt: z.iso.datetime(),
  slotStart: z.iso.datetime().nullable(),
});

const TodaySchema = z.object({
  lanes: z.object({
    needsYou: z.array(LeadCardSchema),
    waitingOnCustomer: z.array(LeadCardSchema),
    booked: z.array(LeadCardSchema),
    wentQuiet: z.array(LeadCardSchema),
  }),
});

const MeSchema = z.object({
  displayName: z.string(),
  role: z.enum(['owner', 'staff']),
  tenant: z.object({ name: z.string(), slug: z.string(), timezone: z.string() }),
  services: z.object({
    texting: z.enum(SERVICE_REGISTRATION_STATES),
    email: z.enum(SERVICE_REGISTRATION_STATES),
  }),
  calendar: z
    .object({
      provider: z.enum(['google', 'acuity']),
      status: z.enum(['connected', 'revoked', 'disconnected']),
    })
    .nullable(),
});

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.logger ?? { level: 'info', redact: { paths: REDACT_PATHS, censor: '[redacted]' } },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('portalUser', null);

  app.get(
    '/health',
    { schema: { response: { 200: z.object({ status: z.literal('ok') }) } } },
    async () => {
      await deps.pool.query('select 1');
      return { status: 'ok' as const };
    },
  );

  // Portal routes: every request is signed in and runs in its user's tenant.
  app.register(
    async (portal) => {
      const typed = portal.withTypeProvider<ZodTypeProvider>();
      typed.addHook('preHandler', requirePortalUser(deps.pool, deps.verifyToken));

      typed.get(
        '/me',
        {
          schema: {
            response: { 200: MeSchema, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
          },
        },
        async (request, reply) => {
          const user = request.portalUser!;
          const me = await withTenant(deps.pool, user.tenantId, (client) =>
            getMe(client, user.tenantId, user.portalUserId),
          );
          return me ?? reply.code(404).send({ error: 'not_found' });
        },
      );

      typed.get(
        '/today',
        { schema: { response: { 200: TodaySchema, 401: ErrorSchema, 403: ErrorSchema } } },
        async (request) => {
          const user = request.portalUser!;
          const lanes = await withTenant(deps.pool, user.tenantId, (client) =>
            getToday(client, user.tenantId),
          );
          return { lanes };
        },
      );
    },
    { prefix: '/portal' },
  );

  return app;
}
