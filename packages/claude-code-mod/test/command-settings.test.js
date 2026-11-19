'use strict';

const { loadRegistryData } = require('@smr/config');
const {
  createRouter,
  settingsFromOptions,
  withMode,
  withTuning,
  parseRouteCommand,
  formatStatus,
  formatExplain,
  formatStats,
  summarize,
  lastMainRecord,
  statusLine,
  tokensOf,
  addTokens,
  contextTokensAfter,
} = require('../src');

const router = createRouter({ data: loadRegistryData() });

describe('settingsFromOptions', () => {
  it('defaults to shadow, local-only, classifier off', () => {
    const { settings, warnings } = settingsFromOptions();
    expect(settings.routing.mode).toBe('shadow');
    expect(settings.privacy.mode).toBe('local-only');
    expect(settings.classifier.enabled).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('reads valid options, case-insensitively', () => {
    const { settings } = settingsFromOptions({ defaultMode: 'AUTO', privacyMode: 'hybrid', aiClassifier: 'on' });
    expect(settings.routing.mode).toBe('auto');
    expect(settings.classifier).toMatchObject({ enabled: true, provider: 'agent-session' });
  });

  it('falls back and warns on an unknown value, echoing at most 40 characters', () => {
    const { settings, warnings } = settingsFromOptions({ defaultMode: 'x'.repeat(100), privacyMode: '' });
    expect(settings.routing.mode).toBe('shadow');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`"${'x'.repeat(40)}"`);
    expect(warnings[0]).not.toContain('x'.repeat(41));
  });

  it('withMode switches modes and ignores unknown ones', () => {
    const { settings } = settingsFromOptions();
    expect(withMode(settings, 'auto').routing.mode).toBe('auto');
    expect(withMode(settings, 'nope')).toBe(settings);
    expect(withMode(settings, 'shadow')).toBe(settings);
  });

  it('withTuning takes sticky and weights from the daemon, never mode, privacy or the classifier', () => {
    const { settings } = settingsFromOptions({ defaultMode: 'auto' });
    const tuned = withTuning(settings, {
      sticky: { enabled: false, minScoreGain: 0.4 },
      weights: { quality: 1, cost: 0.9, latency: 0.1, transition: 0.2 },
      mode: 'off',
      privacy: { mode: 'cloud-ai' },
    });
    expect(tuned.routing).toMatchObject({ mode: 'auto', sticky: { enabled: false, minScoreGain: 0.4 }, weights: { cost: 0.9 } });
    expect(tuned.privacy.mode).toBe('local-only');
    expect(tuned.classifier.enabled).toBe(false);
    expect(withTuning(settings, { sticky: { minScoreGain: 7 } })).toBe(settings);
    expect(withTuning(settings, null)).toBe(settings);
    expect(withTuning(settings, 'x')).toBe(settings);
  });
});

describe('parseRouteCommand', () => {
  it.each([
    ['', { kind: 'status' }],
    ['status', { kind: 'status' }],
    ['help', { kind: 'help' }],
    ['AUTO', { kind: 'mode', mode: 'auto' }],
    ['off', { kind: 'mode', mode: 'off' }],
    ['clear', { kind: 'clear' }],
    ['explain', { kind: 'explain' }],
    ['stats', { kind: 'stats' }],
    ['opus', { kind: 'override', model: 'anthropic.claude-opus', effort: null, scope: 'session' }],
    ['sonnet high once', { kind: 'override', model: 'anthropic.claude-sonnet', effort: 'high', scope: 'turn' }],
    ['haiku once low', { kind: 'override', model: 'anthropic.claude-haiku', effort: 'low', scope: 'turn' }],
  ])('%j', (args, expected) => {
    expect(parseRouteCommand(args, router)).toEqual(expected);
  });

  it.each(['auto now', 'clear all', 'opus high low', 'opus fast', 'gpt-9', 'fable'])('rejects %j', (args) => {
    expect(parseRouteCommand(args, router).kind).toBe('error');
  });

  it('refuses an effort the model does not take', () => {
    const narrow = { resolveManual: () => ({ id: 'acme.small', supportedEffort: ['low'] }) };
    expect(parseRouteCommand('small max', narrow).message).toMatch(/does not take effort max/);
  });
});

function record(overrides = {}) {
  return {
    decision: {
      mode: 'auto',
      subagentId: null,
      selection: { model: 'anthropic.claude-haiku', effort: 'low' },
      status: 'applied',
      decisionSource: 'classifier-rules',
      reason: 'bug_fix → anthropic.claude-haiku',
      classification: { taskType: 'bug_fix', complexity: 0.2, reasoning: 'low', risk: 'low', scope: 'single_file', confidence: 0.8 },
      alternatives: [{ model: 'anthropic.claude-sonnet', score: 0.5, reason: 'quality 1' }],
      estimatedCostUsd: 0.001,
      ...overrides.decision,
    },
    verified: true,
    answeredBy: ['claude-haiku-5-5'],
    steps: 1,
    trace: ['required tier 1.2'],
    ...overrides.record,
  };
}

describe('formatting', () => {
  it('status names the mode, override, warnings and the last turn', () => {
    const text = formatStatus({
      mode: 'auto',
      override: { model: 'anthropic.claude-opus', effort: 'high', scope: 'turn' },
      warnings: ['defaultMode: bad'],
      records: [record()],
    });
    expect(text).toContain('mode: auto');
    expect(text).toContain('override: anthropic.claude-opus/high (next turn)');
    expect(text).toContain('settings warning: defaultMode: bad');
    expect(text).toContain('main applied: anthropic.claude-haiku/low');
    expect(formatStatus({ mode: 'shadow', override: null, warnings: [], records: [] })).toContain('override: none');
  });

  it('status and explain use the last main turn, not a subagent that finished later', () => {
    const main = record();
    const sub = record({ decision: { subagentId: 'sub-1', selection: { model: 'anthropic.claude-opus', effort: null } } });
    expect(lastMainRecord([main, sub])).toBe(main);
    expect(lastMainRecord([sub])).toBeUndefined();
    expect(formatStatus({ mode: 'auto', override: null, warnings: [], records: [main, sub] })).toContain('main applied: anthropic.claude-haiku');
  });

  it('explain shows the reason, the task, alternatives and trace', () => {
    const text = formatExplain(record());
    expect(text).toContain('reason: bug_fix');
    expect(text).toContain('alternative anthropic.claude-sonnet');
    expect(text).toContain('trace: required tier');
    expect(formatExplain(undefined)).toBe('No routed turn yet.');
    expect(formatExplain(record({ record: { verified: false, answeredBy: [] }, decision: { classification: null } }))).toContain('not verified');
  });

  it('stats count models, statuses and cost, with unknown prices called out', () => {
    const records = [record(), record({ decision: { status: 'failed', estimatedCostUsd: null, subagentId: 'x' }, record: { answeredBy: [] } })];
    expect(summarize(records)).toEqual({
      total: 2,
      subagentTurns: 1,
      byModel: { 'claude-haiku-5-5': 1, unknown: 1 },
      byStatus: { applied: 1, failed: 1 },
      costUsd: 0.001,
      unknownCost: 1,
    });
    const text = formatStats(records);
    expect(text).toContain('answered by claude-haiku-5-5: 1 (50%)');
    expect(text).toContain('(+1 turn(s) with unknown price)');
    expect(text).toContain('turns: 2 (1 main, 1 subagent)');
    expect(formatStats([])).toBe('No routed turn yet.');
  });

  it('status line marks applied, failed and recommended', () => {
    expect(statusLine(record())).toBe('router[auto] → haiku/low');
    expect(statusLine(record({ decision: { status: 'failed' } }))).toContain('✗');
    expect(statusLine(record({ decision: { status: 'recommended', selection: { model: 'anthropic.claude-opus', effort: null } } }))).toBe('router[auto] ≈ opus');
  });
});

describe('usage', () => {
  it('maps Claude Code usage and sums it', () => {
    const u = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 };
    expect(tokensOf(u)).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 20 });
    expect(tokensOf(null)).toBeNull();
    expect(tokensOf({ input_tokens: -3, output_tokens: 1.5 })).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(addTokens([tokensOf(u), null, tokensOf(u)]).cacheReadTokens).toBe(200);
    expect(contextTokensAfter(u)).toBe(135);
    expect(contextTokensAfter(undefined)).toBeNull();
  });
});
