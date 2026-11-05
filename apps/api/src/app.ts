import {
  AiSettingsSchema,
  BusinessHoursListSchema,
  BusinessProfileSchema,
  HOLD_STATES,
  ONBOARDING_STEPS,
  LEAD_SOURCES,
  LEAD_STATES,
  REQUEST_STATES,
  SERVICE_REGISTRATION_STATES,
  URGENCIES,
} from '@fsc/core';
import { PORTAL_ACTIONS } from '@fsc/conversation';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyServerOptions,
} from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type pg from 'pg';
import { z } from 'zod';
import { requirePortalUser, type PortalUser, type TokenVerifier } from './auth.js';
import { withTenant, type DbClient } from './db.js';
import { applyAction } from './repositories/actions.js';
import { sendReply } from './repositories/replies.js';
import { getLead } from './repositories/lead.js';
import { getMe } from './repositories/me.js';
import {
  getSettings,
  restoreSettings,
  saveSettings,
  SETTINGS_KINDS,
  type SettingsKind,
  type WriteResult,
} from './repositories/settings.js';
import {
  confirmBusinessType,
  getOnboarding,
  markTemplatesReviewed,
  runTestCall,
  saveApprovers,
  saveBusinessDetails,
  saveHours,
  type OnboardingError,
} from './repositories/onboarding.js';
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
  '*.ein',
  '*.contactPhone',
  '*.contactEmail',
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
  urgent: z.boolean(),
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

const VersionMeta = {
  version: z.number().int().min(1),
  active: z.boolean(),
  createdAt: IsoDate,
  createdByName: z.string().nullable(),
};

const TemplateKey = z.string().regex(/^[a-z][a-z_]{1,59}$/);

const SettingsSchema = z.object({
  canEdit: z.boolean(),
  businessName: z.string(),
  templates: z.object({
    versions: z.array(z.object({ ...VersionMeta, content: z.record(TemplateKey, z.string()) })),
  }),
  ai: z.object({
    available: z.boolean(),
    versions: z.array(z.object({ ...VersionMeta, content: AiSettingsSchema })),
  }),
});

const TemplateProblemsSchema = z.object({
  error: z.literal('template_problems'),
  problems: z.array(
    z.object({
      key: z.string(),
      problems: z.array(
        z.object({
          code: z.string(),
          placeholder: z.string().optional(),
          characters: z.array(z.string()).optional(),
          segments: z.number().int().optional(),
        }),
      ),
    }),
  ),
});

const SettingsWriteResponses = {
  200: SettingsSchema,
  401: ErrorSchema,
  403: ErrorSchema,
  404: ErrorSchema,
  409: ErrorSchema,
  422: TemplateProblemsSchema,
};

const HoursBlockSchema = z.object({
  days: z.array(z.number().int().min(1).max(7)),
  open: z.string(),
  close: z.string(),
});

const OnboardingSchema = z.object({
  canEdit: z.boolean(),
  steps: z.array(z.object({ key: z.enum(ONBOARDING_STEPS), done: z.boolean() })),
  businessType: z
    .object({
      key: z.string(),
      name: z.string(),
      description: z.string(),
      minimumData: z.boolean(),
      approverChannel: z.enum(['text', 'portal']),
      confirmedAt: IsoDate.nullable(),
    })
    .nullable(),
  details: z
    .object({
      legalName: z.string(),
      ein: z.string().optional(),
      street: z.string(),
      city: z.string(),
      region: z.string(),
      postalCode: z.string(),
      website: z.string().optional(),
      contactName: z.string(),
      contactEmail: z.string(),
      contactPhone: z.string(),
      updatedAt: IsoDate,
    })
    .nullable(),
  hours: z.array(HoursBlockSchema),
  timezone: z.string(),
  calendar: z
    .object({
      provider: z.enum(['google', 'acuity']),
      status: z.enum(['connected', 'revoked', 'disconnected']),
    })
    .nullable(),
  templates: z.object({
    version: z.number().int().nullable(),
    reviewedAt: IsoDate.nullable(),
    questions: z.array(z.string()),
  }),
  team: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      role: z.enum(['owner', 'staff']),
      mobile: z.string().nullable(),
      approvesRequests: z.boolean(),
    }),
  ),
  test: z.object({ simulatedAt: IsoDate.nullable() }),
  connectNumber: z.string().nullable(),
});

const TestCallStepSchema = z.union([
  z.object({
    kind: z.literal('missed_call'),
    to: z.string().nullable(),
    from: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('text_to_caller'),
    templateKey: z.string(),
    body: z.string().nullable(),
  }),
  z.object({ kind: z.literal('caller_replies'), body: z.string() }),
  z.object({
    kind: z.literal('approval_request'),
    channel: z.enum(['text', 'portal']),
    approver: z.string().nullable(),
    body: z.string().nullable(),
  }),
  z.object({ kind: z.literal('approver_approves'), channel: z.enum(['text', 'portal']) }),
]);

/** A form the owner fills in: which fields need fixing, in plain words. */
const FieldProblemsSchema = z.object({
  error: z.literal('invalid_fields'),
  fields: z.record(z.string(), z.string()),
});

const OnboardingWriteResponses = {
  200: OnboardingSchema,
  401: ErrorSchema,
  403: ErrorSchema,
  409: ErrorSchema,
  422: FieldProblemsSchema,
};

/** Zod issues as `{ field: message }`, first message per field. */
function fieldProblems(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join('.') : 'form';
    fields[key] ??= issue.message;
  }
  return fields;
}

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

      // Settings: everyone in the business can read them; only the owner changes them. Each write
      // answers with the settings as they now stand (decision 24).
      typed.get(
        '/settings',
        { schema: { response: { 200: SettingsSchema, 401: ErrorSchema, 403: ErrorSchema } } },
        async (request) => {
          const user = request.portalUser!;
          return withTenant(deps.pool, user.tenantId, (client) =>
            getSettings(client, user.tenantId, user.role),
          );
        },
      );

      const writeSettings = async (
        user: PortalUser,
        reply: FastifyReply,
        write: (client: DbClient) => Promise<WriteResult>,
      ) => {
        if (user.role !== 'owner') return reply.code(403).send({ error: 'owner_only' });
        const outcome = await withTenant(deps.pool, user.tenantId, async (client) => {
          const written = await write(client);
          return written.ok
            ? { ok: true as const, settings: await getSettings(client, user.tenantId, user.role) }
            : written;
        });
        if (outcome.ok) return outcome.settings;
        if (outcome.error === 'template_problems') return reply.code(422).send(outcome);
        return reply.code(outcome.error === 'not_found' ? 404 : 409).send({ error: outcome.error });
      };

      // `id` comes from the client, so submitting the same save twice writes one version.
      // `baseVersion` is the live version the editor started from.
      const saveBody = <T extends z.ZodType>(content: T) =>
        z
          .object({ id: z.uuid(), baseVersion: z.number().int().min(1).nullable(), content })
          .strict();

      typed.put(
        '/settings/templates',
        {
          schema: {
            body: saveBody(z.record(TemplateKey, z.string().max(1600))),
            response: SettingsWriteResponses,
          },
        },
        async (request, reply) => {
          const user = request.portalUser!;
          return writeSettings(user, reply, (client) =>
            saveSettings(client, user.tenantId, user.portalUserId, 'templates', request.body),
          );
        },
      );

      typed.put(
        '/settings/ai',
        { schema: { body: saveBody(AiSettingsSchema), response: SettingsWriteResponses } },
        async (request, reply) => {
          const user = request.portalUser!;
          return writeSettings(user, reply, (client) =>
            saveSettings(client, user.tenantId, user.portalUserId, 'ai', request.body),
          );
        },
      );

      typed.post(
        '/settings/:kind/restore',
        {
          schema: {
            params: z.object({ kind: z.enum(SETTINGS_KINDS) }),
            body: z
              .object({
                version: z.number().int().min(1),
                baseVersion: z.number().int().min(1).nullable(),
              })
              .strict(),
            response: SettingsWriteResponses,
          },
        },
        async (request, reply) => {
          const user = request.portalUser!;
          const kind: SettingsKind = request.params.kind;
          return writeSettings(user, reply, (client) =>
            restoreSettings(client, user.tenantId, user.portalUserId, kind, request.body),
          );
        },
      );

      // Onboarding: everyone in the business can see setup progress; only the owner changes it.
      // Details are captured only, never sent to a vendor (Phase 4). Each write answers with
      // the setup as it now stands (decision 24).
      typed.get(
        '/onboarding',
        { schema: { response: { 200: OnboardingSchema, 401: ErrorSchema, 403: ErrorSchema } } },
        async (request) => {
          const user = request.portalUser!;
          return withTenant(deps.pool, user.tenantId, (client) =>
            getOnboarding(client, user.tenantId, user.role),
          );
        },
      );

      const writeOnboarding = async (
        user: PortalUser,
        reply: FastifyReply,
        write: (
          client: DbClient,
        ) => Promise<void | { ok: true } | { ok: false; error: OnboardingError }>,
      ) => {
        if (user.role !== 'owner') return reply.code(403).send({ error: 'owner_only' });
        const outcome = await withTenant(deps.pool, user.tenantId, async (client) => {
          const written = await write(client);
          if (written && !written.ok) return written;
          return {
            ok: true as const,
            onboarding: await getOnboarding(client, user.tenantId, user.role),
          };
        });
        return outcome.ok ? outcome.onboarding : reply.code(409).send({ error: outcome.error });
      };

      typed.post(
        '/onboarding/business-type',
        { schema: { response: OnboardingWriteResponses } },
        async (request, reply) => {
          const user = request.portalUser!;
          return writeOnboarding(user, reply, (client) =>
            confirmBusinessType(client, user.tenantId, user.portalUserId),
          );
        },
      );

      // Fields arrive as typed; @fsc/core normalizes them and names any that need fixing.
      typed.put(
        '/onboarding/details',
        {
          schema: {
            body: z.record(z.string(), z.string().max(300)),
            response: OnboardingWriteResponses,
          },
        },
        async (request, reply) => {
          const user = request.portalUser!;
          const parsed = BusinessProfileSchema.safeParse(request.body);
          if (!parsed.success) {
            return reply
              .code(422)
              .send({ error: 'invalid_fields' as const, fields: fieldProblems(parsed.error) });
          }
          return writeOnboarding(user, reply, (client) =>
            saveBusinessDetails(client, user.tenantId, user.portalUserId, parsed.data),
          );
        },
      );

      typed.put(
        '/onboarding/hours',
        {
          schema: {
            body: z.object({ hours: z.array(HoursBlockSchema).max(14) }).strict(),
            response: OnboardingWriteResponses,
          },
        },
        async (request, reply) => {
          const user = request.portalUser!;
          const parsed = BusinessHoursListSchema.safeParse(request.body.hours);
          if (!parsed.success) {
            return reply
              .code(422)
              .send({ error: 'invalid_fields' as const, fields: fieldProblems(parsed.error) });
          }
          return writeOnboarding(user, reply, (client) =>
            saveHours(client, user.tenantId, user.portalUserId, parsed.data),
          );
        },
      );

      typed.post(
        '/onboarding/templates-reviewed',
        { schema: { response: OnboardingWriteResponses } },
        async (request, reply) => {
          const user = request.portalUser!;
          return writeOnboarding(user, reply, (client) =>
            markTemplatesReviewed(client, user.tenantId, user.portalUserId),
          );
        },
      );

      typed.put(
        '/onboarding/approvers',
        {
          schema: {
            body: z.object({ approverIds: z.array(z.uuid()).max(50) }).strict(),
            response: OnboardingWriteResponses,
          },
        },
        async (request, reply) => {
          const user = request.portalUser!;
          return writeOnboarding(user, reply, (client) =>
            saveApprovers(client, user.tenantId, user.portalUserId, request.body.approverIds),
          );
        },
      );

      // A simulation until texting is live: nothing is called, texted or created.
      typed.post(
        '/onboarding/test-call',
        {
          schema: {
            response: {
              200: z.object({
                simulated: z.literal(true),
                steps: z.array(TestCallStepSchema),
                onboarding: OnboardingSchema,
              }),
              401: ErrorSchema,
              403: ErrorSchema,
              409: ErrorSchema,
            },
          },
        },
        async (request, reply) => {
          const user = request.portalUser!;
          if (user.role !== 'owner') return reply.code(403).send({ error: 'owner_only' });
          const outcome = await withTenant(deps.pool, user.tenantId, async (client) => {
            const run = await runTestCall(client, user.tenantId, user.portalUserId);
            if (!run.ok) return run;
            return {
              ok: true as const,
              steps: run.steps,
              onboarding: await getOnboarding(client, user.tenantId, user.role),
            };
          });
          if (!outcome.ok) return reply.code(409).send({ error: outcome.error });
          return { simulated: true as const, steps: outcome.steps, onboarding: outcome.onboarding };
        },
      );
    },
    { prefix: '/portal' },
  );

  return app;
}
