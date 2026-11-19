'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStorage, MEMORY } = require('@smr/storage');
const { resolvePaths, readToken } = require('@smr/config');
const { createApp } = require('../src/app');
const { startServer } = require('../src/run');

const TOKEN = 'f'.repeat(64);
const PORT = 3101;
const HOST = `127.0.0.1:${PORT}`;

function record(id) {
  return {
    decision: {
      id,
      sessionId: 's1',
      turnId: 't1',
      agentId: 'claude-code',
      mode: 'auto',
      selection: { model: 'anthropic.claude-haiku', effort: 'low' },
      reason: 'typo → haiku',
      decisionSource: 'classifier-rules',
      status: 'applied',
      appliedModel: 'claude-haiku-5-5',
      createdAt: '2026-11-19T10:00:00.000Z',
    },
    verified: true,
    answeredBy: ['claude-haiku-5-5'],
    steps: 1,
    tokens: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}

describe('createApp', () => {
  let storage;
  let app;
  const onShutdown = vi.fn();
  const post = (url, payload, headers = {}) =>
    app.inject({ method: 'POST', url, payload, headers: { host: HOST, authorization: `Bearer ${TOKEN}`, ...headers } });

  beforeEach(() => {
    storage = openStorage(MEMORY);
    app = createApp({ storage, token: TOKEN, port: PORT, version: '0.1.0', pid: 42, onShutdown });
  });
  afterEach(async () => {
    await app.close();
    storage.close();
  });

  it('answers health without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/health', headers: { host: HOST } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, service: 'smart-model-router', version: '0.1.0', pid: 42 });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('proves it holds the token for a nonce, without revealing it', async () => {
    const { healthProof } = require('@smr/config');
    const nonce = 'a'.repeat(32);
    const res = await app.inject({ method: 'GET', url: `/health?nonce=${nonce}`, headers: { host: HOST } });
    expect(res.json().proof).toBe(healthProof(TOKEN, nonce));
    expect(res.body).not.toContain(TOKEN);
    const bad = await app.inject({ method: 'GET', url: '/health?nonce=zz', headers: { host: HOST } });
    expect(bad.json()).not.toHaveProperty('proof');
  });

  it('fails the whole batch on a storage error so the sender keeps it', async () => {
    const failing = createApp({
      storage: { records: { ingest: () => { throw new Error('SQLITE_FULL'); } } },
      token: TOKEN,
      port: PORT,
      version: '0',
      logger: { info() {}, warn() {}, error() {} },
    });
    const res = await failing.inject({ method: 'POST', url: '/v1/records', payload: { records: [] }, headers: { host: HOST, authorization: `Bearer ${TOKEN}` } });
    expect(res.statusCode).toBe(500);
    await failing.close();
  });

  it('stores records and counts resends as duplicates', async () => {
    const first = await post('/v1/records', { records: [record('a'), record('b')] });
    expect(first.json()).toEqual({ accepted: 2, duplicates: 0, rejected: [] });
    const again = await post('/v1/records', { records: [record('a')] });
    expect(again.json()).toMatchObject({ accepted: 0, duplicates: 1 });
    expect(storage.records.summary().total).toBe(2);
  });

  it('refuses a wrong or missing token', async () => {
    expect((await post('/v1/records', { records: [] }, { authorization: `Bearer ${'0'.repeat(64)}` })).statusCode).toBe(401);
    expect((await post('/v1/records', { records: [] }, { authorization: 'Basic x' })).statusCode).toBe(401);
    expect((await post('/v1/shutdown', {}, { authorization: '' })).statusCode).toBe(401);
  });

  it('refuses a foreign Host (DNS rebinding) and any browser Origin', async () => {
    expect((await app.inject({ method: 'GET', url: '/health', headers: { host: 'evil.example:3101' } })).statusCode).toBe(421);
    expect((await app.inject({ method: 'GET', url: '/health', headers: { host: '127.0.0.1:9999' } })).statusCode).toBe(421);
    expect((await post('/v1/records', { records: [] }, { origin: 'http://localhost:3101' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/health', headers: { host: 'localhost:3101' } })).statusCode).toBe(200);
  });

  it('validates the body', async () => {
    expect((await post('/v1/records', { nope: 1 })).statusCode).toBe(400);
    expect((await post('/v1/records', { records: Array.from({ length: 501 }, (_, i) => record(`r${i}`)) })).statusCode).toBe(413);
    const bad = await post('/v1/records', { records: [{ ...record('x'), prompt: 'secret' }] });
    expect(bad.json().rejected).toHaveLength(1);
    const malformed = await app.inject({
      method: 'POST',
      url: '/v1/records',
      payload: '{ broken',
      headers: { host: HOST, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    });
    expect(malformed.statusCode).toBe(400);
  });

  it('hides internal error details', async () => {
    const broken = createApp({
      storage: { records: { ingest: () => { throw new Error('disk path C:\\secret'); } } },
      token: TOKEN,
      port: PORT,
      version: '0',
      logger: { info() {}, warn() {}, error: vi.fn() },
    });
    const res = await broken.inject({ method: 'POST', url: '/v1/records', payload: { records: [] }, headers: { host: HOST, authorization: `Bearer ${TOKEN}` } });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret');
    const noStop = await broken.inject({ method: 'POST', url: '/v1/shutdown', headers: { host: HOST, authorization: `Bearer ${TOKEN}` } });
    expect(noStop.statusCode).toBe(501);
    await broken.close();
  });

  it('shuts down on request, after answering', async () => {
    const res = await post('/v1/shutdown', {});
    expect(res.json()).toEqual({ ok: true, pid: 42 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(onShutdown).toHaveBeenCalled();
  });

  it('needs a real token', () => {
    expect(() => createApp({ storage, token: 'short', port: PORT, version: '0' })).toThrow(/token/);
  });
});

describe('startServer (real socket on a reserved port)', () => {
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-server-'));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('listens on loopback, writes and removes its pid file', async () => {
    const paths = resolvePaths({ env: { SMR_HOME: tmp } });
    const server = await startServer({ paths, port: PORT, logToFile: true });
    try {
      expect(fs.readFileSync(paths.pidFile, 'utf8').trim()).toBe(String(process.pid));
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      expect((await res.json()).ok).toBe(true);
      expect(readToken(paths.tokenFile)).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await server.close();
    }
    expect(fs.existsSync(paths.pidFile)).toBe(false);
    await expect(fetch(`http://127.0.0.1:${PORT}/health`)).rejects.toThrow();
    await server.close();
  });

  it('closes the database when the port is taken', async () => {
    const paths = resolvePaths({ env: { SMR_HOME: tmp } });
    const first = await startServer({ paths, port: PORT, logToFile: true });
    try {
      await expect(startServer({ paths, port: PORT, logToFile: true })).rejects.toThrow(/EADDRINUSE/);
    } finally {
      await first.close();
    }
  });
});
