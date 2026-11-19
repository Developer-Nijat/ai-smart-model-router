'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStorage, MEMORY } = require('@smr/storage');
const { resolvePaths } = require('@smr/config');
const { createApp } = require('../src/app');
const { createServices } = require('../src/services');
const { createDashboardAuth, CODE_TTL_MS, SESSION_TTL_MS, MAX_SESSIONS } = require('../src/auth');
const { loadStaticFiles } = require('../src/static');

const TOKEN = 'e'.repeat(64);
const PORT = 3102;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://${HOST}`;

const installed = (output) => async () => ({ found: true, output, error: null });
const missing = async () => ({ found: false, output: '', error: 'not found or failed to run' });

function record(id, createdAt = '2026-11-19T09:00:00.000Z') {
  return {
    decision: {
      id,
      sessionId: 's1',
      turnId: id,
      agentId: 'claude-code',
      mode: 'auto',
      selection: { model: 'anthropic.claude-haiku', effort: 'low' },
      reason: 'typo → haiku',
      decisionSource: 'classifier-rules',
      status: 'applied',
      appliedModel: 'claude-haiku-5-5',
      createdAt,
    },
    verified: true,
    answeredBy: ['claude-haiku-5-5'],
    steps: 1,
    tokens: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}

const RULE = { id: 'security-opus', name: 'Security work on Opus', priority: 10, when: { keywords: ['auth'] }, then: { model: 'anthropic.claude-opus', effort: 'high' } };

describe('dashboard sign-in codes and sessions', () => {
  it('trades a code once for a session that expires', () => {
    let t = 0;
    let n = 0;
    const auth = createDashboardAuth({ now: () => t, random: () => (n += 1).toString(16).padStart(64, '0') });
    const { code } = auth.issueCode();
    const { session } = auth.exchange(code);
    expect(auth.check(session)).toBe(true);
    expect(auth.exchange(code)).toBeNull();
    t = SESSION_TTL_MS;
    expect(auth.check(session)).toBe(false);
  });

  it('refuses expired codes, malformed keys and revoked sessions, and caps sessions', () => {
    let t = 0;
    let n = 0;
    const auth = createDashboardAuth({ now: () => t, random: () => (n += 1).toString(16).padStart(64, '0') });
    const late = auth.issueCode().code;
    t = CODE_TTL_MS;
    expect(auth.exchange(late)).toBeNull();
    expect(auth.check('x')).toBe(false);
    expect(auth.check(undefined)).toBe(false);
    const sessions = Array.from({ length: MAX_SESSIONS + 1 }, () => auth.exchange(auth.issueCode().code).session);
    expect(auth.check(sessions[0])).toBe(false);
    expect(auth.check(sessions.at(-1))).toBe(true);
    auth.revoke(sessions.at(-1));
    expect(auth.check(sessions.at(-1))).toBe(false);
  });
});

describe('dashboard API', () => {
  let tmp;
  let paths;
  let storage;
  let app;

  const signIn = async () => {
    const { code } = (await app.inject({ method: 'POST', url: '/v1/dashboard/code', headers: { host: HOST, authorization: `Bearer ${TOKEN}` } })).json();
    const res = await app.inject({ method: 'POST', url: '/api/session', payload: { code }, headers: { host: HOST, origin: ORIGIN } });
    return res.json().session;
  };
  const call = (session, method, url, payload) =>
    app.inject({ method, url, payload, headers: { host: HOST, origin: ORIGIN, ...(session ? { 'x-smr-session': session } : {}) } });

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-dash-'));
    paths = resolvePaths({ env: { SMR_HOME: tmp } });
    storage = openStorage(MEMORY);
    const services = createServices({
      paths,
      storage,
      now: () => new Date('2026-11-19T12:00:00.000Z'),
      detectors: { 'claude-code': installed('2.1.328 (Claude Code)'), codex: missing, 'gemini-cli': missing },
    });
    const dist = path.join(tmp, 'dist');
    fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>SMR</title>');
    fs.writeFileSync(path.join(dist, 'assets', 'app-1.js'), 'console.log(1)');
    fs.writeFileSync(path.join(dist, 'notes.exe'), 'MZ');
    app = createApp({ storage, token: TOKEN, port: PORT, version: '0.1.0', dashboard: { services, auth: createDashboardAuth(), files: loadStaticFiles(dist) } });
  });
  afterEach(async () => {
    await app.close();
    storage.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('needs a session for every API route, and a valid code to get one', async () => {
    expect((await call(undefined, 'GET', '/api/overview')).statusCode).toBe(401);
    expect((await call('f'.repeat(64), 'GET', '/api/overview')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/dashboard/code', headers: { host: HOST } })).statusCode).toBe(401);
    const bad = await app.inject({ method: 'POST', url: '/api/session', payload: { code: '0'.repeat(64) }, headers: { host: HOST, origin: ORIGIN } });
    expect(bad.statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/session', payload: { code: 'x' }, headers: { host: HOST } })).statusCode).toBe(400);
    const session = await signIn();
    expect((await call(session, 'GET', '/api/overview')).statusCode).toBe(200);
    expect((await call(session, 'DELETE', '/api/session')).statusCode).toBe(204);
    expect((await call(session, 'GET', '/api/overview')).statusCode).toBe(401);
  });

  it('accepts browser requests only from its own origin, and never on agent endpoints', async () => {
    const session = await signIn();
    expect((await app.inject({ method: 'GET', url: '/api/overview', headers: { host: HOST, origin: 'http://evil.example', 'x-smr-session': session } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/overview', headers: { host: HOST, origin: 'http://127.0.0.1:3000', 'x-smr-session': session } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/v1/records', payload: { records: [] }, headers: { host: HOST, origin: ORIGIN, authorization: `Bearer ${TOKEN}` } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/health', headers: { host: HOST, origin: ORIGIN } })).statusCode).toBe(403);
  });

  it('summarises a period with costs, and lists history', async () => {
    storage.records.ingest([record('a'), record('b', '2026-10-01T09:00:00.000Z')]);
    const session = await signIn();
    const week = (await call(session, 'GET', '/api/overview?period=7d')).json();
    expect(week).toMatchObject({ period: '7d', since: '2026-11-12T12:00:00.000Z', stats: { total: 1 }, comparison: { turnsWithUsage: 1 } });
    expect(week.comparison.actualUsd).toBeGreaterThan(0);
    expect((await call(session, 'GET', '/api/overview?period=all')).json().stats.total).toBe(2);
    expect((await call(session, 'GET', '/api/overview?period=1y')).statusCode).toBe(400);
    expect((await call(session, 'GET', '/api/history?limit=1')).json().map((e) => e.id)).toEqual(['a']);
    expect((await call(session, 'GET', '/api/history?status=nope')).statusCode).toBe(400);
    expect((await call(session, 'GET', '/api/history?session=has%20spaces')).statusCode).toBe(400);
  });

  it('saves valid user rules, refuses invalid ones whole, and serves them to agents with the tuning', async () => {
    const session = await signIn();
    expect((await call(session, 'GET', '/api/rules')).json()).toMatchObject({ rules: [], userError: null });
    const invalid = await call(session, 'PUT', '/api/rules', { rules: [RULE, { ...RULE, then: {} }] });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toMatch(/rule #2/);
    expect((await call(session, 'PUT', '/api/rules', { rules: [RULE, RULE] })).json().error).toMatch(/Duplicate/);
    expect(fs.existsSync(paths.rulesFile)).toBe(false);
    const saved = (await call(session, 'PUT', '/api/rules', { rules: [RULE, { ...RULE, id: 'off', enabled: false }] })).json();
    expect(saved.rules.map((r) => [r.id, r.source])).toEqual([['security-opus', 'user'], ['off', 'user']]);
    const forAgents = await app.inject({ method: 'GET', url: '/v1/routing', headers: { host: HOST, authorization: `Bearer ${TOKEN}` } });
    expect(forAgents.json().rules.map((r) => r.id)).toEqual(['security-opus']);
    expect(forAgents.json().tuning).toEqual({ sticky: { enabled: true, minScoreGain: 0.15 }, weights: { quality: 1, cost: 0.3, latency: 0.1, transition: 0.5 } });
    expect((await app.inject({ method: 'GET', url: '/v1/routing', headers: { host: HOST } })).statusCode).toBe(401);
  });

  it('reports a broken user rules file instead of failing, and refuses to serve it to agents', async () => {
    fs.mkdirSync(path.dirname(paths.rulesFile), { recursive: true });
    fs.writeFileSync(paths.rulesFile, '{ broken');
    const session = await signIn();
    expect((await call(session, 'GET', '/api/rules')).json().userError).toBeTruthy();
    expect((await app.inject({ method: 'GET', url: '/v1/routing', headers: { host: HOST, authorization: `Bearer ${TOKEN}` } })).statusCode).toBe(400);
  });

  it('changes settings with validation and says when a restart is needed', async () => {
    const session = await signIn();
    const settings = (await call(session, 'GET', '/api/settings')).json();
    expect(settings.routing.mode).toBe('shadow');
    const bad = await call(session, 'PUT', '/api/settings', { settings: { ...settings, routing: { ...settings.routing, mode: 'turbo' } } });
    expect(bad.statusCode).toBe(400);
    const mode = (await call(session, 'PUT', '/api/settings', { settings: { ...settings, routing: { ...settings.routing, mode: 'auto' } } })).json();
    expect(mode).toMatchObject({ settings: { routing: { mode: 'auto' } }, restartNeeded: false });
    const port = (await call(session, 'PUT', '/api/settings', { settings: { ...mode.settings, server: { ...mode.settings.server, port: 4800 } } })).json();
    expect(port.restartNeeded).toBe(true);
  });

  it('treats a broken config.json on disk as a server fault, and too many rules as a bad request', async () => {
    const session = await signIn();
    expect((await call(session, 'PUT', '/api/rules', { rules: Array.from({ length: 201 }, (_, i) => ({ ...RULE, id: `r${i}` })) })).statusCode).toBe(400);
    const manyKeywords = { ...RULE, when: { keywords: Array.from({ length: 51 }, (_, i) => `k${i}`) } };
    expect((await call(session, 'PUT', '/api/rules', { rules: [manyKeywords] })).statusCode).toBe(400);
    fs.mkdirSync(path.dirname(paths.configFile), { recursive: true });
    fs.writeFileSync(paths.configFile, '{ "routing": { "mode": "turbo" } }');
    const res = await call(session, 'GET', '/api/settings');
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe('internal error');
  });

  it('lists models with prices, detects and lists agents, and lists benchmarks', async () => {
    const session = await signIn();
    const models = (await call(session, 'GET', '/api/models')).json();
    expect(models.find((m) => m.id === 'anthropic.claude-haiku').price.inputPerMillion).toBeGreaterThan(0);
    expect((await call(session, 'GET', '/api/agents')).json()).toEqual([]);
    const found = (await call(session, 'POST', '/api/agents/detect')).json();
    expect(found.find((a) => a.id === 'claude-code')).toMatchObject({ installed: true, version: '2.1.328' });
    expect((await call(session, 'GET', '/api/agents')).json()).toHaveLength(3);
    expect((await call(session, 'GET', '/api/benchmarks')).json()).toEqual([]);
  });

  it('serves the built dashboard with a strict policy, routing unknown pages to the app', async () => {
    const get = (url) => app.inject({ method: 'GET', url, headers: { host: HOST } });
    const index = await get('/');
    expect(index.headers['content-type']).toMatch(/text\/html/);
    expect(index.headers['content-security-policy']).toContain("script-src 'self'");
    expect(index.headers['x-frame-options']).toBe('DENY');
    expect((await get('/history?x=1')).body).toContain('<title>SMR</title>');
    const asset = await get('/assets/app-1.js');
    expect(asset.headers['content-type']).toMatch(/javascript/);
    expect(asset.headers['cache-control']).toContain('immutable');
    expect((await get('/assets/missing.js')).statusCode).toBe(404);
    expect((await get('/notes.exe')).statusCode).toBe(404);
    expect((await get('/../package.json')).statusCode).toBe(404);
    expect((await get('/api/nope')).statusCode).toBe(404);
  });

  it('says the dashboard is not built when there is nothing to serve', async () => {
    const bare = createApp({ storage, token: TOKEN, port: PORT, version: '0', dashboard: { services: {}, auth: createDashboardAuth(), files: loadStaticFiles(path.join(tmp, 'none')) } });
    const res = await bare.inject({ method: 'GET', url: '/', headers: { host: HOST } });
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatch(/npm run build:dashboard/);
    await bare.close();
  });

  it('without a dashboard, refuses every browser request as before', async () => {
    const plain = createApp({ storage, token: TOKEN, port: PORT, version: '0' });
    expect((await plain.inject({ method: 'GET', url: '/', headers: { host: HOST, origin: ORIGIN } })).statusCode).toBe(403);
    expect((await plain.inject({ method: 'GET', url: '/', headers: { host: HOST } })).statusCode).toBe(404);
    await plain.close();
  });
});
