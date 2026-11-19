'use strict';

const { DECISION_STATUSES } = require('@smr/shared');

const SESSION_HEADER = 'x-smr-session';
const HEX64 = { type: 'string', pattern: '^[0-9a-f]{64}$' };

/**
 * The dashboard API under /api (ADR-005). Every route but sign-in needs a session key
 * from `createDashboardAuth`, sent in the `x-smr-session` header: a header no other
 * site can make a browser send, so cross-site request forgery has nothing to ride on.
 *
 * @param {import('fastify').FastifyInstance} app
 * @param {{ services: ReturnType<typeof import('./services').createServices>, auth: ReturnType<typeof import('./auth').createDashboardAuth> }} options
 */
function registerApi(app, { services, auth }) {
  app.register(
    async (api) => {
      api.addHook('onRequest', async (request, reply) => {
        if (request.method === 'POST' && request.routeOptions.url === '/api/session') return undefined;
        if (!auth.check(request.headers[SESSION_HEADER])) return reply.code(401).send({ error: 'sign in again: run mr dashboard' });
        return undefined;
      });

      api.post('/session', { schema: { body: { type: 'object', required: ['code'], additionalProperties: false, properties: { code: HEX64 } } } }, async (request, reply) => {
        const session = auth.exchange(request.body.code);
        if (!session) return reply.code(401).send({ error: 'this sign-in link has expired or was used: run mr dashboard again' });
        return session;
      });

      api.delete('/session', async (request, reply) => {
        auth.revoke(request.headers[SESSION_HEADER]);
        return reply.code(204).send();
      });

      api.get('/overview', { schema: { querystring: periodQuery(services.periods, '7d') } }, async (request) => services.overview(request.query.period));

      api.get(
        '/history',
        {
          schema: {
            querystring: {
              type: 'object',
              additionalProperties: false,
              properties: {
                limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
                session: { type: 'string', pattern: '^[A-Za-z0-9_.:@/-]{1,200}$' },
                status: { type: 'string', enum: DECISION_STATUSES },
                period: { type: 'string', enum: services.periods, default: 'all' },
              },
            },
          },
        },
        async (request) => {
          const { limit, session, status, period } = request.query;
          return services.history({ limit, sessionId: session, status, period });
        },
      );

      api.get('/rules', async () => services.rules());
      api.put(
        '/rules',
        { schema: { body: { type: 'object', required: ['rules'], additionalProperties: false, properties: { rules: { type: 'array' } } } } },
        async (request) => services.saveUserRules(request.body.rules),
      );

      api.get('/models', async () => services.models());
      api.get('/agents', async () => services.agents());
      api.post('/agents/detect', async () => services.detectAgents());

      api.get('/settings', async () => services.settings());
      api.put(
        '/settings',
        { schema: { body: { type: 'object', required: ['settings'], additionalProperties: false, properties: { settings: { type: 'object' } } } } },
        async (request) => services.saveSettings(request.body.settings),
      );

      api.get('/benchmarks', async () => services.benchmarks());
    },
    { prefix: '/api' },
  );
}

function periodQuery(periods, fallback) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: { period: { type: 'string', enum: periods, default: fallback } },
  };
}

module.exports = { registerApi, SESSION_HEADER };
