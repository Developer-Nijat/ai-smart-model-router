'use strict';

const Fastify = require('fastify');
const { MAX_RECORDS_PER_BATCH } = require('@smr/shared');
const { tokensMatch, healthProof } = require('@smr/config');
const { registerApi } = require('./api');

const SERVICE = 'smart-model-router';
/** A full batch of the largest valid records (alternatives and trace at their caps) fits. */
const BODY_LIMIT = 8 * 1024 * 1024;
const LOOPBACK_NAMES = Object.freeze(['127.0.0.1', 'localhost', '[::1]']);
/** The dashboard runs no inline code and loads nothing from elsewhere. */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * The local daemon's HTTP app (ADR-003): agent integrations post what happened in their
 * sessions; with `dashboard` it also serves the dashboard and its API (ADR-005).
 *
 * Local-only defences:
 * - the Host header must name a loopback address and our port (no DNS rebinding);
 * - a browser request (one with an Origin header) is accepted only from the dashboard's
 *   own origin, and never on the agent endpoints (/v1) or /health;
 * - agent endpoints need the bearer token from the owner-only token file; the dashboard
 *   API needs a session key (see auth.js); the API token never reaches a browser.
 *
 * @param {{
 *   storage: { records: { ingest(records: unknown[]): object } },
 *   token: string,
 *   port: number,
 *   version: string,
 *   pid?: number,
 *   logger?: { info: Function, warn: Function, error: Function },
 *   onShutdown?: () => void,
 *   dashboard?: {
 *     services: ReturnType<typeof import('./services').createServices>,
 *     auth: ReturnType<typeof import('./auth').createDashboardAuth>,
 *     files: Map<string, { type: string, body: Buffer }> | null,
 *   },
 * }} options
 */
function createApp(options) {
  const { storage, token, port, version } = options;
  if (typeof token !== 'string' || token.length < 32) throw new TypeError('createApp needs the API token');
  const pid = options.pid ?? process.pid;
  const logger = options.logger;
  const allowedHosts = new Set(LOOPBACK_NAMES.map((name) => `${name}:${port}`));

  const dashboard = options.dashboard ?? null;
  const app = Fastify({ logger: false, bodyLimit: BODY_LIMIT });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    if (!allowedHosts.has(String(request.headers.host ?? '').toLowerCase())) {
      return reply.code(421).send({ error: 'unexpected Host header' });
    }
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    reply.header('content-security-policy', CONTENT_SECURITY_POLICY);
    const origin = request.headers.origin;
    if (origin !== undefined) {
      const ownOrigin = `http://${String(request.headers.host).toLowerCase()}`;
      // The matched route, not the raw URL: no prefix trick can dodge the rule.
      const route = request.routeOptions?.url ?? '';
      const agentOnly = route.startsWith('/v1/') || route === '/health' || !route;
      if (!dashboard || agentOnly || origin !== ownOrigin) {
        return reply.code(403).send({ error: 'browser requests from other pages are not accepted' });
      }
    }
    return undefined;
  });

  app.setErrorHandler((error, request, reply) => {
    // Invalid settings or rules sent by the dashboard are the caller's mistake, said plainly;
    // a broken file on disk (E_CONFIG) is the daemon's problem and stays a logged 500.
    const invalid = error.code === 'E_VALIDATION';
    const status = invalid ? 400 : error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    if (status === 500) logger?.error('request failed', { route: request.routeOptions?.url, error: error.message });
    // Client errors say what was wrong; server errors never leak details.
    reply.code(status).send({ error: status === 500 ? 'internal error' : error.message });
  });

  // With `?nonce=<hex>` the answer proves the daemon holds the token, without sending it.
  app.get('/health', async (request) => {
    const proof = healthProof(token, request.query?.nonce);
    return { ok: true, service: SERVICE, version, pid, ...(proof ? { proof } : {}) };
  });

  const authorized = (request) => {
    const header = String(request.headers.authorization ?? '');
    return tokensMatch(header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null, token);
  };

  app.post('/v1/records', async (request, reply) => {
    if (!authorized(request)) return reply.code(401).send({ error: 'missing or wrong token' });

    const records = request.body?.records;
    if (!Array.isArray(records)) return reply.code(400).send({ error: 'body must be { "records": [...] }' });
    if (records.length > MAX_RECORDS_PER_BATCH) {
      return reply.code(413).send({ error: `at most ${MAX_RECORDS_PER_BATCH} records per request` });
    }
    const result = storage.records.ingest(records);
    if (result.rejected.length > 0) logger?.warn('records rejected', { count: result.rejected.length, first: result.rejected[0].reason });
    return result;
  });

  // `mr stop` asks politely first: on Windows a kill skips the shutdown handlers.
  app.post('/v1/shutdown', async (request, reply) => {
    if (!authorized(request)) return reply.code(401).send({ error: 'missing or wrong token' });
    if (typeof options.onShutdown !== 'function') return reply.code(501).send({ error: 'shutdown not available' });
    reply.raw.once('finish', () => setImmediate(options.onShutdown));
    return { ok: true, pid };
  });

  if (dashboard) registerDashboard(app, dashboard, authorized);

  return app;
}

/** Agent-side helpers for the dashboard, its API and its static files. */
function registerDashboard(app, { services, auth, files }, authorized) {
  // `mr dashboard` holds the token and asks for a one-time sign-in code for the browser.
  app.post('/v1/dashboard/code', async (request, reply) => {
    if (!authorized(request)) return reply.code(401).send({ error: 'missing or wrong token' });
    return auth.issueCode();
  });

  // Agent integrations fetch the rules (shipped and the user's) and scoring tuning in force.
  app.get('/v1/routing', async (request, reply) => {
    if (!authorized(request)) return reply.code(401).send({ error: 'missing or wrong token' });
    return services.effectiveRouting();
  });

  registerApi(app, { services, auth });

  app.get('/*', async (request, reply) => {
    if (!files) return reply.code(404).type('text/plain; charset=utf-8').send('dashboard not built: npm run build:dashboard, then mr stop and mr start');
    const url = request.url.split('?')[0];
    if (url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    // Unknown paths without a file extension are dashboard pages: the app routes them.
    const file = files.get(url === '/' ? '/index.html' : url) ?? (/\.[a-z0-9]+$/i.test(url) ? null : files.get('/index.html'));
    if (!file) return reply.code(404).type('text/plain; charset=utf-8').send('not found');
    if (url.startsWith('/assets/')) reply.header('cache-control', 'public, max-age=31536000, immutable');
    return reply.type(file.type).send(file.body);
  });
}

module.exports = { createApp, SERVICE, BODY_LIMIT, CONTENT_SECURITY_POLICY };
