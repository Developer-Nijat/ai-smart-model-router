// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { App } from '../src/App.jsx';
import { SignedOut, ApiError } from '../src/api.js';
import { BarList } from '../src/components/BarList.jsx';
import { setIn } from '../src/pages/Settings.jsx';

const CODE = 'a'.repeat(64);

const OVERVIEW = {
  period: '7d',
  since: '2026-11-12T00:00:00.000Z',
  last: '2026-11-19T09:00:00.000Z',
  stats: {
    total: 4,
    mainTurns: 3,
    subagentTurns: 1,
    sessions: 2,
    first: '2026-11-18T09:00:00.000Z',
    last: '2026-11-19T09:00:00.000Z',
    knownCostUsd: 0.0123,
    unknownCostTurns: 1,
    tokens: { input: 52000, output: 4000, cacheRead: 1200000, cacheWrite: 0 },
    byStatus: { applied: 3, recommended: 1 },
    byAnsweredModel: { 'claude-haiku-5-5': 3, 'claude-opus-5-5': 1 },
    bySelectedModel: { 'anthropic.claude-haiku': 3, 'anthropic.claude-sonnet': 1 },
    bySource: { 'classifier-rules': 4 },
    byTaskType: { bug_fix: 2, typo: 2 },
    byMode: { auto: 4 },
  },
  comparison: { turnsWithUsage: 3, comparedTurns: 2, excludedTurns: 1, actualUsd: 0.0123, sameTokensOnlyOn: { 'anthropic.claude-haiku': 0.004, 'anthropic.claude-opus': 0.05 } },
};

const ENTRY = {
  id: 's1:t1',
  sessionId: 's1',
  subagentId: null,
  mode: 'auto',
  status: 'applied',
  taskType: 'bug_fix',
  selection: { model: 'anthropic.claude-haiku', effort: 'low' },
  appliedModel: 'claude-haiku-5-5',
  estimatedCostUsd: 0.0012,
  reason: 'bug_fix, low complexity → claude-haiku',
  decisionSource: 'classifier-rules',
  verified: true,
  steps: 2,
  classification: { complexity: 0.2, risk: 'low', scope: 'single_file', confidence: 0.8 },
  tokens: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
  createdAt: '2026-11-19T09:00:00.000Z',
};

const SETTINGS = {
  version: 1,
  routing: { mode: 'shadow', sticky: { enabled: true, minScoreGain: 0.15 }, weights: { quality: 1, cost: 0.3, latency: 0.1, transition: 0.5 } },
  privacy: { mode: 'local-only', storePrompts: false },
  classifier: { enabled: false, provider: 'agent-session', model: null, confidenceThreshold: 0.7, timeoutMs: 3000 },
  server: { host: '127.0.0.1', port: 4747 },
  logging: { level: 'info' },
};

const RULE = { id: 'security-opus', name: 'Security on Opus', enabled: true, priority: 10, when: { taskTypes: ['security'] }, then: { model: 'anthropic.claude-opus', effort: 'high' } };

function fakeApi(overrides = {}) {
  let rules = [RULE];
  return {
    signedIn: true,
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    overview: vi.fn(async (period) => ({ ...OVERVIEW, period })),
    history: vi.fn(async () => [ENTRY, { ...ENTRY, id: 's1:t2', subagentId: 'sub', status: 'failed', estimatedCostUsd: null, tokens: null, classification: null }]),
    rules: vi.fn(async () => ({ file: '/home/x/rules.json', userError: null, user: rules, rules: rules.map((r) => ({ ...r, source: 'user' })) })),
    saveRules: vi.fn(async (next) => {
      rules = next;
      return {};
    }),
    models: vi.fn(async () => [
      { id: 'anthropic.claude-haiku', name: 'Claude Haiku', claudeCode: 'haiku', tier: 'small', status: 'enabled', efforts: ['low', 'high'], contextWindow: 200000, price: { inputPerMillion: 0.1, outputPerMillion: 0.5, cacheReadPerMillion: 0.01, cacheWritePerMillion: 0.125, asOf: '2026-11-19', sourceUrl: 'https://platform.claude.com/docs/pricing' } },
      { id: 'anthropic.claude-x', name: 'Claude X', claudeCode: null, tier: 'large', status: 'disabled', efforts: [], contextWindow: null, price: null },
    ]),
    agents: vi.fn(async () => [{ id: 'claude-code', displayName: 'Claude Code', installed: true, version: '2.1.328', capabilities: { turnLevelRouting: true, subagentRouting: true, promptLevelRouting: false, usageTracking: true }, notes: [], detectedAt: '2026-11-19T09:00:00.000Z' }]),
    detectAgents: vi.fn(async () => []),
    settings: vi.fn(async () => SETTINGS),
    saveSettings: vi.fn(async (settings) => ({ settings, restartNeeded: settings.server.port !== 4747 })),
    benchmarks: vi.fn(async () => []),
    ...overrides,
  };
}

function open(path, api = fakeApi()) {
  window.history.replaceState(null, '', path);
  render(<App api={api} />);
  return api;
}

const nav = (name) => fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name }));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('sign-in', () => {
  it('asks to run mr dashboard when signed out', () => {
    open('/', fakeApi({ signedIn: false }));
    expect(screen.getByText('mr dashboard')).toBeTruthy();
  });

  it('trades a #code link for a session and removes it from the address', async () => {
    const api = fakeApi({ signedIn: false });
    open(`/#code=${CODE}`, api);
    expect(window.location.hash).toBe('');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Overview' })).toBeTruthy());
    expect(api.signIn).toHaveBeenCalledWith(CODE);
  });

  it('says why a link failed', async () => {
    open(`/#code=${CODE}`, fakeApi({ signedIn: false, signIn: vi.fn(async () => Promise.reject(new ApiError('this sign-in link has expired', 401))) }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/expired/));
  });

  it('shows a failed link even while already signed in', async () => {
    open(`/#code=${CODE}`, fakeApi({ signIn: vi.fn(async () => Promise.reject(new ApiError('this sign-in link has expired', 401))) }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/expired/));
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeTruthy();
  });

  it('returns to sign-in when the session ends, and on sign out', async () => {
    open('/', fakeApi({ overview: vi.fn(async () => Promise.reject(new SignedOut('your session ended'))) }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/session ended: run mr dashboard/));
    cleanup();
    const api = open('/');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.getByText('mr dashboard')).toBeTruthy());
    expect(api.signOut).toHaveBeenCalled();
  });
});

describe('pages', () => {
  it('overview shows totals, distributions and the cost comparison, per period', async () => {
    const api = open('/');
    const tile = (await screen.findByText('Routed turns')).parentElement;
    expect(tile.textContent).toBe('Routed turns43 main · 1 subagent');
    expect(screen.getByText('+ 1 turn(s) with an unknown price')).toBeTruthy();
    expect(screen.getByText('52k / 4,000')).toBeTruthy();
    expect(screen.getByLabelText('claude-haiku-5-5: 3 turns, 75%')).toBeTruthy();
    expect(screen.getByText('Only claude-opus').closest('tr').textContent).toBe('Only claude-opus$0.0500');
    expect(screen.getByText(/Over 2 of 3 turn\(s\)/).textContent).toContain('1 turn(s) left out');
    expect(screen.getByText('Estimated API-equivalent cost').parentElement.textContent).toContain('$0.0123');
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '30d' } });
    await waitFor(() => expect(api.overview).toHaveBeenLastCalledWith('30d'));
  });

  it('overview shows a dash, not $0, when no turn has a known price', async () => {
    open('/', fakeApi({ overview: vi.fn(async () => ({ ...OVERVIEW, stats: { ...OVERVIEW.stats, knownCostUsd: 0, unknownCostTurns: 4 } })) }));
    const tile = (await screen.findByText('Estimated API-equivalent cost')).parentElement;
    expect(tile.textContent).toContain('—');
    expect(tile.textContent).not.toContain('$0');
  });

  it('overview says when there is nothing yet', async () => {
    open('/', fakeApi({ overview: vi.fn(async () => ({ ...OVERVIEW, stats: { ...OVERVIEW.stats, total: 0 }, last: null })) }));
    expect(await screen.findByText(/No routed turns in this period/)).toBeTruthy();
  });

  it('history lists decisions, filters, and explains one', async () => {
    const api = open('/history');
    expect(await screen.findAllByText('claude-haiku/low')).toHaveLength(2);
    expect(within(screen.getByRole('table')).getByText('failed')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Why' })[0]);
    expect(screen.getByText(ENTRY.reason)).toBeTruthy();
    expect(screen.getByText('single file')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'failed' } });
    await waitFor(() => expect(api.history).toHaveBeenLastCalledWith({ status: 'failed', period: 'all', limit: 100 }));
  });

  it('rules toggles, deletes and saves edited JSON, without changing the loaded list in place', async () => {
    const api = open('/rules');
    await screen.findByText('security-opus');
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(api.saveRules).toHaveBeenCalledWith([{ ...RULE, enabled: false }]));
    expect(RULE.enabled).toBe(true);
    await screen.findByText('Rule security-opus updated.');
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    const box = screen.getByLabelText('Rules JSON');
    fireEvent.change(box, { target: { value: '{ not json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Not valid JSON/);
    fireEvent.change(box, { target: { value: '{}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }));
    expect(screen.getByRole('alert').textContent).toMatch(/JSON array/);
    fireEvent.change(box, { target: { value: '[]' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }));
    await waitFor(() => expect(api.saveRules).toHaveBeenLastCalledWith([]));
  });

  it('rules shows a server refusal and deletes a rule', async () => {
    const api = open('/rules', fakeApi({ saveRules: vi.fn(async () => Promise.reject(new ApiError('Invalid rule #1: id', 400))) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete rule security-opus' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Invalid rule #1/));
    expect(api.saveRules).toHaveBeenCalledWith([]);
  });

  it('models list prices and sources; unknown prices show as a dash', async () => {
    open('/models');
    expect(await screen.findByText('Claude Haiku')).toBeTruthy();
    expect(screen.getByText('$0.125')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'platform.claude.com' }).getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText('Claude X').closest('tr').textContent).toContain('—');
  });

  it('agents lists detection and runs it again', async () => {
    const api = open('/agents');
    expect(await screen.findByText('turns, subagents')).toBeTruthy();
    expect(screen.queryByText(/usageTracking/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Detect again' }));
    await waitFor(() => expect(api.detectAgents).toHaveBeenCalled());
  });

  it('settings saves edits and says when a restart is needed', async () => {
    const api = open('/settings');
    const port = await screen.findByLabelText('Port');
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true);
    fireEvent.change(port, { target: { value: '4800' } });
    fireEvent.click(screen.getByLabelText('Sticky routing'));
    fireEvent.change(screen.getByLabelText('Routing mode'), { target: { value: 'auto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/after mr stop and mr start/);
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Reset' }).disabled).toBe(true);
    const saved = api.saveSettings.mock.calls[0][0];
    expect(saved).toMatchObject({ server: { port: 4800 }, routing: { mode: 'auto', sticky: { enabled: false } } });
    expect(SETTINGS.server.port).toBe(4747);
  });

  it('settings shows a refusal', async () => {
    open('/settings', fakeApi({ saveSettings: vi.fn(async () => Promise.reject(new ApiError('Refusing to save invalid settings', 400))) }));
    fireEvent.change(await screen.findByLabelText('Weight: cost'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Refusing/));
  });

  it('navigates without reloading and switches theme', async () => {
    open('/');
    nav('Models');
    expect(window.location.pathname).toBe('/models');
    expect(await screen.findByRole('heading', { name: 'Models' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Light theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'Dark theme' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('BarList', () => {
  it('folds categories beyond the limit into other and shows the figure on focus', () => {
    render(<BarList counts={{ a: 5, b: 4, c: 3, d: 2 }} total={14} max={3} />);
    expect(screen.getByLabelText('other: 5 turns, 36%')).toBeTruthy();
    fireEvent.focus(screen.getByLabelText('a: 5 turns, 36%'));
    expect(screen.getByRole('tooltip').textContent).toBe('a: 5 of 14 turns (36%)');
    fireEvent.blur(screen.getByLabelText('a: 5 turns, 36%'));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('says when there is nothing to show', () => {
    render(<BarList counts={{}} total={0} empty="nothing" />);
    expect(screen.getByText('nothing')).toBeTruthy();
  });
});

describe('setIn', () => {
  it('returns a new object and leaves the original alone', () => {
    const original = { a: { b: 1, c: 2 } };
    const next = setIn(original, 'a.b', 5);
    expect(next).toEqual({ a: { b: 5, c: 2 } });
    expect(original.a.b).toBe(1);
    expect(setIn({}, 'x.y', 1)).toEqual({ x: { y: 1 } });
  });
});
