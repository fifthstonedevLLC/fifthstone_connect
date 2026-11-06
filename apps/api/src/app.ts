import {
  HOLD_STATES,
  LEAD_SOURCES,
  LEAD_STATES,
  REQUEST_STATES,
  SERVICE_REGISTRATION_STATES,
  URGENCIES,
} from '@fsc/core';
import { PORTAL_ACTIONS } from '@fsc/conversation';
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
import { applyAction } from './repositories/actions.js';
import { sendReply } from './repositories/replies.js';
import { getLead } from './repositories/lead.js';
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
  requestState: z.enum(['pending', 'approved', 'changed']).nullable(),
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

const IsoDate = z.iso.datetime();

const LeadDetailSchema = z.object({
  id: z.uuid(),
  source: z.enum(LEAD_SOURCES),
  state: z.enum(LEAD_STATES),
  reason: z.string().nullable(),
  urgency: z.enum(URGENCIES).nullable(),
  category: z.string().nullable(),
  summary: z.string().nullable(),
  address: z.string().nullable(),
  createdAt: IsoDate,
  contact: z.object({
    name: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    earlierLeads: z.number().int().min(0),
  }),
  voicemail: z
    .object({
      durationSeconds: z.number().int(),
      transcript: z.string().nullable(),
      confidence: z.number().min(0).max(1).nullable(),
      receivedAt: IsoDate,
    })
    .nullable(),
  messages: z.array(
    z.object({
      id: z.uuid(),
      direction: z.enum(['in', 'out']),
      author: z.enum(['customer', 'template', 'staff', 'ai_question']),
      templateKey: z.string().nullable(),
      body: z.string(),
      deliveryStatus: z.enum(['received', 'queued', 'sent', 'delivered', 'undelivered', 'failed']),
      occurredAt: IsoDate,
    }),
  ),
  request: z
    .object({
      state: z.enum(REQUEST_STATES),
      slotStart: IsoDate,
      slotEnd: IsoDate,
      decidedAt: IsoDate.nullable(),
      decidedVia: z.enum(['text', 'portal']).nullable(),
      decidedByName: z.string().nullable(),
      hold: z.object({ state: z.enum(HOLD_STATES), expiresAt: IsoDate }).nullable(),
    })
    .nullable(),
  pendingWork: z.array(
    z.object({
      actionType: z.string(),
      status: z.enum(['queued', 'running', 'failed', 'dead']),
    }),
  ),
  replyOptions: z.array(z.object({ key: z.string(), body: z.string() })),
});

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.logger ?? { level: 'info', redact: { paths: REDACT_PATHS, censor: '[redacted]' } },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('portalUser', null);

  // Errors return a short code only; details stay in the (redacted) server log.
  app.setErrorHandler((error: { validation?: unknown; statusCode?: number }, request, reply) => {
    if (error.validation) return reply.code(400).send({ error: 'invalid_request' });
    request.log.error({ err: error }, 'request failed');
    return reply.code(500).send({ error: 'internal' });
  });

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

      // Another business's lead is a plain 404, never a 403: the API does not confirm it exists.
      typed.get(
        '/leads/:id',
        {
          schema: {
            params: z.object({ id: z.uuid() }),
            response: {
              200: LeadDetailSchema,
              401: ErrorSchema,
              403: ErrorSchema,
              404: ErrorSchema,
            },
          },
        },
        async (request, reply) => {
          const user = request.portalUser!;
          const lead = await withTenant(deps.pool, user.tenantId, (client) =>
            getLead(client, user.tenantId, request.params.id),
          );
          return lead ?? reply.code(404).send({ error: 'not_found' });
        },
      );

      // Owners and staff can take every action (decision 25). The response is the lead as it now
      // stands in the database, so the portal shows the true result (decision 24). A refused
      // action is a 409 with a short reason; nothing was written.
      typed.post(
        '/leads/:id/actions',
        {
          schema: {
            params: z.object({ id: z.uuid() }),
            body: z.object({ action: z.enum(PORTAL_ACTIONS) }).strict(),
            response: {
              200: LeadDetailSchema,
              401: ErrorSchema,
              403: ErrorSchema,
              404: ErrorSchema,
              409: ErrorSchema,
            },
          },
        },
        async (request, reply) => {
          const user = request.portalUser!;
          const { id } = request.params;
          const outcome = await withTenant(deps.pool, user.tenantId, async (client) => {
            const applied = await applyAction(
              client,
              user.tenantId,
              user.portalUserId,
              id,
              request.body.action,
            );
            return applied.ok
              ? { ok: true as const, lead: await getLead(client, user.tenantId, id) }
              : applied;
          });
          if (!outcome.ok) {
            return reply
              .code(outcome.error === 'not_found' ? 404 : 409)
              .send({ error: outcome.error });
          }
          return outcome.lead ?? reply.code(404).send({ error: 'not_found' });
        },
      );

      // Template replies only (decision 26). `messageId` comes from the client, so submitting the
      // same reply twice records one message. Answers with the lead as it now stands.
      typed.post(
        '/leads/:id/replies',
        {
          schema: {
            params: z.object({ id: z.uuid() }),
            body: z
              .object({
                templateKey: z.string().regex(/^[a-z][a-z_]{1,59}$/),
                messageId: z.uuid(),
              })
              .strict(),
            response: {
              200: LeadDetailSchema,
              401: ErrorSchema,
              403: ErrorSchema,
              404: ErrorSchema,
              409: ErrorSchema,
            },
          },
        },
        async (request, reply) => {
          const user = request.portalUser!;
          const { id } = request.params;
          const outcome = await withTenant(deps.pool, user.tenantId, async (client) => {
            const sent = await sendReply(
              client,
              user.tenantId,
              user.portalUserId,
              id,
              request.body.templateKey,
              request.body.messageId,
            );
            return sent.ok
              ? { ok: true as const, lead: await getLead(client, user.tenantId, id) }
              : sent;
          });
          if (!outcome.ok) {
            return reply
              .code(outcome.error === 'not_found' ? 404 : 409)
              .send({ error: outcome.error });
          }
          return outcome.lead ?? reply.code(404).send({ error: 'not_found' });
        },
      );
    },
    { prefix: '/portal' },
  );

  return app;
}
