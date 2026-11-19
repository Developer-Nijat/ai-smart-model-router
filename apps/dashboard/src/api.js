const SESSION_KEY = 'smr-session';
const CODE_PATTERN = /^[0-9a-f]{64}$/;

/** sessionStorage can be missing or throw (private windows, blocked storage): never fatal. */
function safeStorage(storage) {
  return {
    get: () => {
      try {
        return storage?.getItem(SESSION_KEY) ?? null;
      } catch {
        return null;
      }
    },
    set: (value) => {
      try {
        storage?.setItem(SESSION_KEY, value);
      } catch {
        // Kept in memory only for this page.
      }
    },
    clear: () => {
      try {
        storage?.removeItem(SESSION_KEY);
      } catch {
        // Nothing stored.
      }
    },
  };
}

export class SignedOut extends Error {
  constructor(message = 'signed out') {
    super(message);
    this.name = 'SignedOut';
  }
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * The dashboard's client for /api. The session key lives in this tab's sessionStorage
 * (private to this origin) and goes in a header; the API token never reaches the page.
 *
 * @param {{ fetch?: typeof fetch, storage?: Storage | null }} [options]
 */
export function createApi(options = {}) {
  const doFetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
  const store = safeStorage(options.storage === undefined ? globalThis.sessionStorage : options.storage);
  let session = store.get();

  async function request(method, path, body) {
    if (!session) throw new SignedOut();
    const res = await doFetch(`/api${path}`, {
      method,
      headers: { 'x-smr-session': session, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
    });
    if (res.status === 401) {
      session = null;
      store.clear();
      throw new SignedOut('your session ended');
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(data?.error ?? `request failed (${res.status})`, res.status);
    return data;
  }

  return {
    get signedIn() {
      return Boolean(session);
    },

    /** Trades the one-time code from `mr dashboard` for a session. */
    async signIn(code) {
      if (!CODE_PATTERN.test(code ?? '')) throw new ApiError('this sign-in link is malformed: run mr dashboard again', 400);
      const res = await doFetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
        credentials: 'omit',
        cache: 'no-store',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || typeof data?.session !== 'string') throw new ApiError(data?.error ?? 'sign-in failed: run mr dashboard again', res.status);
      session = data.session;
      store.set(session);
    },

    async signOut() {
      try {
        if (session) await request('DELETE', '/session');
      } finally {
        session = null;
        store.clear();
      }
    },

    overview: (period) => request('GET', `/overview?period=${encodeURIComponent(period)}`),
    history: ({ limit = 100, status, period = 'all', session: sessionId } = {}) => {
      const query = new URLSearchParams({ limit: String(limit), period });
      if (status) query.set('status', status);
      if (sessionId) query.set('session', sessionId);
      return request('GET', `/history?${query}`);
    },
    rules: () => request('GET', '/rules'),
    saveRules: (rules) => request('PUT', '/rules', { rules }),
    models: () => request('GET', '/models'),
    agents: () => request('GET', '/agents'),
    detectAgents: () => request('POST', '/agents/detect'),
    settings: () => request('GET', '/settings'),
    saveSettings: (settings) => request('PUT', '/settings', { settings }),
    benchmarks: () => request('GET', '/benchmarks'),
  };
}

/** The `code` in a `#code=…` fragment, or null. */
export function codeFromHash(hash) {
  const match = /^#code=([0-9a-f]{64})$/.exec(hash ?? '');
  return match ? match[1] : null;
}
