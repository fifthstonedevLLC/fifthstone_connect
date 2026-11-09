import { createHash } from 'node:crypto';
import type { InboundRequest, PhoneEvents } from '@fsc/connectors';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { withoutTenant, withTenant } from './db.js';
import { recordPhoneEvent } from './repositories/intake.js';

/**
 * Provider webhooks. Each request is verified by the connector before anything is read, then
 * the event is stored and acted on in one transaction before the API answers (CLAUDE.md rules 1
 * and 2). Until Phase 4 the connector is the labeled mock (`MockPhoneEvents`); the real Twilio
 * adapter replaces it without changing this route.
 *
 * Answers carry no customer data. A number that is not a business's (or a disabled business)
 * gets the same answer as a recorded event, so the API never confirms who is a customer.
 */
export async function webhookRoutes(
  app: FastifyInstance,
  deps: { pool: pg.Pool; phoneEvents: PhoneEvents },
): Promise<void> {
  // Signatures are checked against the exact bytes received, so the body stays a string.
  app.addContentTypeParser(
    ['application/json', 'application/x-www-form-urlencoded'],
    { parseAs: 'string' },
    (_request, body, done) => done(null, body),
  );

  app.post('/webhooks/phone', async (request, reply) => {
    const inbound: InboundRequest = {
      url: `${request.protocol}://${request.hostname}${request.url}`,
      headers: Object.fromEntries(
        Object.entries(request.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v]),
      ),
      body: typeof request.body === 'string' ? request.body : '',
    };
    if (!deps.phoneEvents.verify(inbound)) {
      return reply.code(403).send({ error: 'invalid_signature' });
    }
    const parsed = deps.phoneEvents.parse(inbound);
    if (!parsed.ok) return reply.code(400).send({ error: 'invalid_event' });
    const event = parsed.value;

    // Delivery receipts for sent texts are handled with the real provider (Phase 4).
    if (event.kind === 'text_status') return reply.code(200).send({ status: 'accepted' });

    const tenantId = await withoutTenant(deps.pool, async (client) => {
      const { rows } = await client.query<{ tenant_id: string | null }>(
        `select app.resolve_inbound_tenant('phone', $1) as tenant_id`,
        [event.to],
      );
      return rows[0]?.tenant_id ?? null;
    });
    if (!tenantId) return reply.code(200).send({ status: 'accepted' });

    const sha = createHash('sha256').update(inbound.body).digest('hex');
    await withTenant(deps.pool, tenantId, (client) =>
      recordPhoneEvent(client, tenantId, event, sha),
    );
    return reply.code(200).send({ status: 'accepted' });
  });
}
