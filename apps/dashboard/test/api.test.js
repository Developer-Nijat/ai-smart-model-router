import { createApi, codeFromHash, SignedOut, ApiError } from '../src/api.js';
import { int, usd, pct, shortModel, time, label } from '../src/format.js';

const CODE = 'a'.repeat(64);
const SESSION = 'b'.repeat(64);

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k), data };
}

const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

describe('dashboard API client', () => {
  it('signs in with a code, then sends the session key in a header, never a cookie', async () => {
    const calls = [];
    const fetch = async (url, init) => {
      calls.push([url, init]);
      return url === '/api/session' ? json(200, { session: SESSION }) : json(200, { ok: true });
    };
    const storage = memoryStorage();
    const api = createApi({ fetch, storage });
    expect(api.signedIn).toBe(false);
    await expect(api.overview('7d')).rejects.toBeInstanceOf(SignedOut);
    await api.signIn(CODE);
    expect(JSON.parse(calls[0][1].body)).toEqual({ code: CODE });
    expect(storage.data.get('smr-session')).toBe(SESSION);
    await api.overview('7d');
    const [url, init] = calls[1];
    expect(url).toBe('/api/overview?period=7d');
    expect(init.headers['x-smr-session']).toBe(SESSION);
    expect(init.credentials).toBe('omit');
  });

  it('builds each request', async () => {
    const calls = [];
    const fetch = async (url, init) => {
      calls.push([init.method, url, init.body && JSON.parse(init.body)]);
      return json(200, {});
    };
    const api = createApi({ fetch, storage: memoryStorage({ 'smr-session': SESSION }) });
    await api.history({ status: 'applied', period: '7d', limit: 50, session: 's1' });
    await api.history();
    await api.rules();
    await api.saveRules([{ id: 'x' }]);
    await api.models();
    await api.agents();
    await api.detectAgents();
    await api.settings();
    await api.saveSettings({ a: 1 });
    await api.benchmarks();
    expect(calls).toEqual([
      ['GET', '/api/history?limit=50&period=7d&status=applied&session=s1', undefined],
      ['GET', '/api/history?limit=100&period=all', undefined],
      ['GET', '/api/rules', undefined],
      ['PUT', '/api/rules', { rules: [{ id: 'x' }] }],
      ['GET', '/api/models', undefined],
      ['GET', '/api/agents', undefined],
      ['POST', '/api/agents/detect', undefined],
      ['GET', '/api/settings', undefined],
      ['PUT', '/api/settings', { settings: { a: 1 } }],
      ['GET', '/api/benchmarks', undefined],
    ]);
  });

  it('forgets the session on 401 and reports other errors with the server message', async () => {
    const storage = memoryStorage({ 'smr-session': SESSION });
    let answer = json(400, { error: 'rule #1: bad' });
    const api = createApi({ fetch: async () => answer, storage });
    await expect(api.saveRules([])).rejects.toMatchObject({ name: 'ApiError', message: 'rule #1: bad', status: 400 });
    answer = { status: 500, ok: false, json: async () => Promise.reject(new Error('not json')) };
    await expect(api.rules()).rejects.toThrow('request failed (500)');
    answer = json(401, {});
    await expect(api.rules()).rejects.toBeInstanceOf(SignedOut);
    expect(api.signedIn).toBe(false);
    expect(storage.data.has('smr-session')).toBe(false);
  });

  it('refuses a malformed or rejected code, and signs out even when the server is gone', async () => {
    const api = createApi({ fetch: async () => json(401, { error: 'expired' }), storage: memoryStorage() });
    await expect(api.signIn('nope')).rejects.toBeInstanceOf(ApiError);
    await expect(api.signIn(CODE)).rejects.toThrow('expired');
    const gone = createApi({ fetch: async () => Promise.reject(new Error('offline')), storage: memoryStorage({ 'smr-session': SESSION }) });
    await expect(gone.signOut()).rejects.toThrow('offline');
    expect(gone.signedIn).toBe(false);
    const ok = createApi({ fetch: async () => ({ status: 204, ok: true }), storage: memoryStorage({ 'smr-session': SESSION }) });
    await ok.signOut();
    expect(ok.signedIn).toBe(false);
  });

  it('works when storage is missing or throws', async () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    const api = createApi({ fetch: async (url) => (url === '/api/session' ? json(200, { session: SESSION }) : json(401, {})), storage: broken });
    await api.signIn(CODE);
    expect(api.signedIn).toBe(true);
    await expect(api.rules()).rejects.toBeInstanceOf(SignedOut);
    expect(createApi({ fetch: async () => json(200, {}), storage: null }).signedIn).toBe(false);
  });

  it('reads only a well-formed code from the fragment', () => {
    expect(codeFromHash(`#code=${CODE}`)).toBe(CODE);
    expect(codeFromHash(`#code=${CODE}&x=1`)).toBeNull();
    expect(codeFromHash('#code=abc')).toBeNull();
    expect(codeFromHash(undefined)).toBeNull();
  });
});

describe('format', () => {
  it('shows unknown values as a dash, never zero', () => {
    expect([int(1234.4), int(null)]).toEqual(['1,234', '—']);
    expect([usd(0), usd(0.00213), usd(12.5), usd(null)]).toEqual(['$0', '$0.0021', '$12.50', '—']);
    expect([pct(1, 4), pct(1, 0)]).toEqual(['25%', '—']);
    expect([shortModel('anthropic.claude-opus'), shortModel('claude-opus-5-5'), shortModel(null)]).toEqual(['claude-opus', 'claude-opus-5-5', '—']);
    expect([time('2026-11-19T10:00:00.000Z'), time(null)]).toEqual(['2026-11-19 10:00:00', '—']);
    expect([label('bug_fix'), label(undefined)]).toEqual(['bug fix', '—']);
  });
});
