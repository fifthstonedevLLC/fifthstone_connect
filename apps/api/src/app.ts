import {
  CAPABILITIES,
  FREE_TEXT_CHANNELS,
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
import { CALENDAR_PROVIDERS } from '@fsc/core/calendar-providers';
import { NEEDS, NEXT_ACTIONS, PORTAL_ACTIONS, TRADES } from '@fsc/conversation';
import { isLocalDate, localDate, weekStart } from '@fsc/scheduling';
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
import type { PhoneEvents } from '@fsc/connectors';
import type pg from 'pg';
import { z } from 'zod';
import { requirePortalUser, type PortalUser, type TokenVerifier } from './auth.js';
import { withTenant, type DbClient } from './db.js';
import { applyAction } from './repositories/actions.js';
import { sendReply, type ReplyInput } from './repositories/replies.js';
import { userCan } from './repositories/permissions.js';
import {
  getBusinessSettings,
  saveActNowHours,
  saveFreeTextChannels,
  saveStaffCapabilities,
  setPersonActive,
} from './repositories/business-settings.js';
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
  chooseBusinessType,
  confirmBusinessType,
  declineTexting,
  submitApplication,
  getOnboarding,
  markTemplatesReviewed,
  runTestCall,
  saveApprovers,
  saveBusinessDetails,
  saveHours,
  type OnboardingError,
} from './repositories/onboarding.js';
import { APPOINTMENT_STATUSES, getCalendar } from './repositories/calendar.js';
import { getToday } from './repositories/today.js';
import { webhookRoutes } from './webhooks.js';

/**
 * The HTTP app. Routes are thin: validate input with Zod, call a repository or package function
 * inside the right tenant context, return output that is validated on the way out too.
 */

export interface AppDeps {
  pool: pg.Pool;
  verifyToken: TokenVerifier;
  /** Inbound phone webhooks; the labeled mock until Phase 4. Without it the route is absent. */
  phoneEvents?: PhoneEvents;
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

const IsoSpan = z.object({ start: z.string(), end: z.string() });

const CalendarSchema = z.object({
  timeZone: z.string(),
  from: z.string(),
  days: z.number().int(),
  hours: z.array(
    z.object({ days: z.array(z.number().int()), open: z.string(), close: z.string() }),
  ),
  jobMinutes: z.number().int(),
  connection: z
    .object({
      provider: z.enum(CALENDAR_PROVIDERS),
      status: z.enum(['connected', 'revoked', 'disconnected']),
      lastSyncedAt: z.string().nullable(),
    })
    .nullable(),
  appointments: z.array(
    IsoSpan.extend({
      leadId: z.uuid(),
      name: z.string().nullable(),
      phone: z.string().nullable(),
      summary: z.string().nullable(),
      address: z.string().nullable(),
      status: z.enum(APPOINTMENT_STATUSES),
      holdExpiresAt: z.string().nullable(),
    }),
  ),
  busy: z.array(IsoSpan),
  open: z.array(IsoSpan),
  capacity: z.array(
    z.object({ date: z.string(), openMinutes: z.number(), freeMinutes: z.number() }),
  ),
});

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
  holdExpiresAt: z.iso.datetime().nullable(),
  urgent: z.boolean(),
  waitingSince: z.iso.datetime(),
  next: z.object({ need: z.enum(NEEDS), action: z.enum(NEXT_ACTIONS).nullable() }),
});

const TodaySchema = z.object({
  lanes: z.object({
    needsYou: z.array(LeadCardSchema),
    waitingOnCustomer: z.array(LeadCardSchema),
    booked: z.array(LeadCardSchema),
    wentQuiet: z.array(LeadCardSchema),
  }),
  actNowAfterHours: z.number().int(),
});

const MeSchema = z.object({
  displayName: z.string(),
  role: z.enum(['owner', 'staff']),
  tenant: z.object({ name: z.string(), slug: z.string(), timezone: z.string() }),
  stage: z.enum(['setting_up', 'ready', 'live']),
  textingDeclined: z.boolean(),
  capabilities: z.array(z.enum(CAPABILITIES)),
  freeTextChannels: z.array(z.enum(FREE_TEXT_CHANNELS)),
  services: z.object({
    texting: z.enum(SERVICE_REGISTRATION_STATES),
    email: z.enum(SERVICE_REGISTRATION_STATES),
  }),
  calendar: z
    .object({
      provider: z.enum(CALENDAR_PROVIDERS),
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
  next: z.object({
    need: z.enum(NEEDS),
    action: z.enum(NEXT_ACTIONS).nullable(),
    urgent: z.boolean(),
  }),
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
      approverChannel: z.enum(['text', 'portal']),
      trade: z.object({ key: z.string(), name: z.string() }).nullable(),
      jobMinutes: z.number().int(),
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
      provider: z.enum(CALENDAR_PROVIDERS),
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
  application: z.object({
    ready: z.boolean(),
    submittedAt: IsoDate.nullable(),
    declinedAt: IsoDate.nullable(),
    registration: z.enum(SERVICE_REGISTRATION_STATES),
    preview: z
      .object({
        useCase: z.string(),
        optIn: z.string(),
        sampleMessages: z.array(z.string()),
      })
      .nullable(),
  }),
  stage: z.enum(['setting_up', 'ready', 'live']),
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

/** Portal routes a business can use before it is live: who am I, setup, and its wording. */
const OPEN_BEFORE_LIVE = ['/portal/me', '/portal/onboarding', '/portal/settings'];

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

  const phoneEvents = deps.phoneEvents;
  if (phoneEvents) app.register(webhookRoutes, { pool: deps.pool, phoneEvents });

  // Portal routes: every request is signed in and runs in its user's tenant.
  app.register(
    async (portal) => {
      const typed = portal.withTypeProvider<ZodTypeProvider>();
      typed.addHook('preHandler', requirePortalUser(deps.pool, deps.verifyToken));
      // Until a business is live, only setup is open (decision 35): its working pages stay
      // locked even if someone types their address, and the engine sends nothing for it.
      typed.addHook('preHandler', async (request, reply) => {
        const user = request.portalUser;
        if (!user || user.live) return;
        const url = request.routeOptions.url ?? '';
        if (OPEN_BEFORE_LIVE.some((prefix) => url.startsWith(prefix))) return;
        return reply.code(403).send({ error: 'not_live' });
      });

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
          return withTenant(deps.pool, user.tenantId, (client) => getToday(client, user.tenantId));
        },
      );

      // The calendar for a run of days (a week by default, starting Monday in the business's
      // time zone). Read-only: busy time is what the last sync stored.
      typed.get(
        '/calendar',
        {
          schema: {
            querystring: z.object({
              from: z.string().refine(isLocalDate, 'Use YYYY-MM-DD').optional(),
              days: z.coerce.number().int().min(1).max(14).default(7),
            }),
            response: { 200: CalendarSchema, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
          },
        },
        async (request, reply) => {
          const user = request.portalUser!;
          const view = await withTenant(deps.pool, user.tenantId, async (client) => {
            const tz = await client.query<{ timezone: string }>(
              'select timezone from app.tenants where id = $1',
              [user.tenantId],
            );
            const timeZone = tz.rows[0]?.timezone;
            if (!timeZone) return null;
            const from = request.query.from ?? weekStart(localDate(new Date(), timeZone));
            return getCalendar(client, user.tenantId, { from, days: request.query.days });
          });
          return view ?? reply.code(404).send({ error: 'not_found' });
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
            if (!(await userCan(client, user.tenantId, user.role, 'act_on_leads'))) {
              return { ok: false as const, error: 'not_permitted' as const };
            }
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
            const status =
              outcome.error === 'not_permitted' ? 403 : outcome.error === 'not_found' ? 404 : 409;
            return reply.code(status).send({ error: outcome.error });
          }
          return outcome.lead ?? reply.code(404).send({ error: 'not_found' });
        },
      );

      // A template reply (decision 26), or a person's own words where the owner has switched free
      // text on (decision 39); each needs its own permission (decision 40). `messageId` comes
      // from the client, so submitting the same reply twice records one message. Answers with the
      // lead as it now stands.
      typed.post(
        '/leads/:id/replies',
        {
          schema: {
            params: z.object({ id: z.uuid() }),
            body: z.union([
              z
                .object({
                  templateKey: z.string().regex(/^[a-z][a-z_]{1,59}$/),
                  messageId: z.uuid(),
                })
                .strict(),
              z.object({ text: z.string().max(1600), messageId: z.uuid() }).strict(),
            ]),
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
          const body = request.body;
          const input: ReplyInput =
            'text' in body
              ? { kind: 'text', text: body.text }
              : { kind: 'template', templateKey: body.templateKey };
          const outcome = await withTenant(deps.pool, user.tenantId, async (client) => {
            const needs = input.kind === 'text' ? 'reply_free_text' : 'reply_templates';
            if (!(await userCan(client, user.tenantId, user.role, needs))) {
              return { ok: false as const, error: 'not_permitted' as const };
            }
            const sent = await sendReply(
              client,
              user.tenantId,
              user.portalUserId,
              id,
              input,
              body.messageId,
            );
            return sent.ok
              ? { ok: true as const, lead: await getLead(client, user.tenantId, id) }
              : sent;
          });
          if (!outcome.ok) {
            const status =
              outcome.error === 'not_permitted' ? 403 : outcome.error === 'not_found' ? 404 : 409;
            return reply.code(status).send({ error: outcome.error });
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
        const outcome = await withTenant(deps.pool, user.tenantId, async (client) => {
          if (!(await userCan(client, user.tenantId, user.role, 'edit_templates'))) {
            return { ok: false as const, error: 'not_permitted' as const };
          }
          const written = await write(client);
          return written.ok
            ? { ok: true as const, settings: await getSettings(client, user.tenantId, user.role) }
            : written;
        });
        if (!outcome.ok && outcome.error === 'not_permitted') {
          return reply.code(403).send({ error: 'not_permitted' });
        }
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

      // The Settings page (Iteration 1): everyone reads it; only the owner changes it. Each write
      // answers with the settings as they now stand (decision 24).
      const BusinessSettingsSchema = z.object({
        canEdit: z.boolean(),
        team: z.array(
          z.object({
            id: z.uuid(),
            name: z.string(),
            role: z.enum(['owner', 'staff']),
            mobile: z.string().nullable(),
            approvesRequests: z.boolean(),
            active: z.boolean(),
          }),
        ),
        staffCapabilities: z.array(z.enum(CAPABILITIES)),
        freeTextChannels: z.array(z.enum(FREE_TEXT_CHANNELS)),
        actNowAfterHours: z.number().int(),
        texting: z.object({
          state: z.enum(SERVICE_REGISTRATION_STATES),
          declined: z.boolean(),
        }),
      });
      const BusinessWriteResponses = {
        200: BusinessSettingsSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
      };
      typed.get(
        '/business',
        {
          schema: { response: { 200: BusinessSettingsSchema, 401: ErrorSchema, 403: ErrorSchema } },
        },
        async (request) => {
          const user = request.portalUser!;
          return withTenant(deps.pool, user.tenantId, (client) =>
            getBusinessSettings(client, user.tenantId, user.role),
          );
        },
      );
      const writeBusiness = async (
        user: PortalUser,
        reply: FastifyReply,
        write: (client: DbClient) => Promise<{ ok: true } | { ok: false; error: string }>,
      ) => {
        if (user.role !== 'owner') return reply.code(403).send({ error: 'owner_only' });
        const outcome = await withTenant(deps.pool, user.tenantId, async (client) => {
          const written = await write(client);
          return written.ok
            ? {
                ok: true as const,
                settings: await getBusinessSettings(client, user.tenantId, user.role),
              }
            : written;
        });
        if (outcome.ok) return outcome.settings;
        return reply.code(outcome.error === 'not_found' ? 404 : 409).send({ error: outcome.error });
      };
      typed.put(
        '/business/permissions',
        {
          schema: {
            body: z.object({ staffCapabilities: z.array(z.enum(CAPABILITIES)) }).strict(),
            response: BusinessWriteResponses,
          },
        },
        async (request, reply) => {
          const user = request.portalUser!;
          return writeBusiness(user, reply, (client) =>
            saveStaffCapabilities(
              client,
              user.tenantId,
              user.portalUserId,
              request.body.staffCapabilities,
            ),
          );
        },
      );
      typed.put(
        '/business/free-text',
        {
          schema: {
            body: z.object({ channels: z.array(z.enum(FREE_TEXT_CHANNELS)) }).strict(),
            response: BusinessWriteResponses,
          },
        },
        async (request, reply) => {
          const user = request.portalUser!;
          return writeBusiness(user, reply, (client) =>
            saveFreeTextChannels(client, user.tenantId, user.portalUserId, request.body.channels),
          );
        },
      );
      typed.put(
        '/business/act-now',
        {
          schema: {
            body: z.object({ hours: z.number().int().min(1).max(168) }).strict(),
            response: BusinessWriteResponses,
          },
        },
        async (request, reply) => {
          const user = request.portalUser!;
          return writeBusiness(user, reply, (client) =>
            saveActNowHours(client, user.tenantId, user.portalUserId, request.body.hours),
          );
        },
      );
      typed.put(
        '/business/team/:id',
        {
          schema: {
            params: z.object({ id: z.uuid() }),
            body: z.object({ active: z.boolean() }).strict(),
            response: BusinessWriteResponses,
          },
        },
        async (request, reply) => {
          const user = request.portalUser!;
          return writeBusiness(user, reply, (client) =>
            setPersonActive(
              client,
              user.tenantId,
              user.portalUserId,
              request.params.id,
              request.body.active,
            ),
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

      // The owner sends the texting application once setup is done (decision 35).
      typed.post(
        '/onboarding/application',
        {
          schema: {
            body: z.object({ confirmed: z.boolean() }),
            response: OnboardingWriteResponses,
          },
        },
        async (request, reply) => {
          const user = request.portalUser!;
          return writeOnboarding(user, reply, (client) =>
            submitApplication(
              client,
              user.tenantId,
              user.portalUserId,
              user.role,
              request.body.confirmed,
            ),
          );
        },
      );

      // Or the owner goes without texting for now (decision 36).
      typed.post(
        '/onboarding/no-texting',
        { schema: { response: OnboardingWriteResponses } },
        async (request, reply) => {
          const user = request.portalUser!;
          return writeOnboarding(user, reply, (client) =>
            declineTexting(client, user.tenantId, user.portalUserId, user.role),
          );
        },
      );

      // Picking a business type applies its starter wording and instructions (decision 34).
      typed.put(
        '/onboarding/business-type',
        {
          schema: {
            body: z.object({ trade: z.enum(TRADES.map((t) => t.key) as [string, ...string[]]) }),
            response: OnboardingWriteResponses,
          },
        },
        async (request, reply) => {
          const user = request.portalUser!;
          return writeOnboarding(user, reply, (client) =>
            chooseBusinessType(client, user.tenantId, user.portalUserId, request.body.trade),
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
