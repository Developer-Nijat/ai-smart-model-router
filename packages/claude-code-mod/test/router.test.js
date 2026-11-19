'use strict';

const { loadRegistryData } = require('@smr/config');
const { createRouter, settingsFromOptions, withMode, withOverride, afterClear } = require('../src');

const router = createRouter({ data: loadRegistryData(), rules: [] });
const auto = settingsFromOptions({ defaultMode: 'auto' }).settings;
const shadow = settingsFromOptions({}).settings;
const CREATED = '2026-11-19T10:00:00.000Z';
const usage = (model, extra = {}) => ({
  model,
  input_tokens: 1000,
  output_tokens: 500,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  ...extra,
});

async function plan(text, { settings = auto, state = router.newSession('s1'), observedModel = 'claude-opus-5-5' } = {}) {
  const classified = await router.classify({ text, state, settings });
  return router.decideTurn({ state, settings, text, classified, ids: { decisionId: 'd1', turnId: 't1' }, createdAt: CREATED, observedModel });
}

describe('decideTurn', () => {
  it('sends a typo to haiku/low in auto mode, as Claude Code names it', async () => {
    const p = await plan("Fix the typo in the word 'helo'");
    expect(p).toMatchObject({ shouldApply: true, agentModel: 'haiku', agentEffort: 'low' });
    expect(p.decision.selection.model).toBe('anthropic.claude-haiku');
  });

  it('sends a security audit to opus', async () => {
    const p = await plan('Audit the auth flow for injection vulnerabilities');
    expect(p.agentModel).toBe('opus');
    expect(['high', 'xhigh']).toContain(p.agentEffort);
  });

  it('only recommends in shadow mode', async () => {
    const p = await plan("Fix the typo in the word 'helo'", { settings: shadow });
    expect(p).toMatchObject({ shouldApply: false, agentModel: null, agentEffort: null });
    expect(p.decision.status).toBe('recommended');
  });

  it('applies a manual override even in shadow mode', async () => {
    const state = withOverride(router.newSession('s1'), { model: 'anthropic.claude-sonnet', effort: 'max', scope: 'turn' });
    const p = await plan("Fix the typo in the word 'helo'", { settings: shadow, state });
    expect(p).toMatchObject({ shouldApply: true, agentModel: 'sonnet', agentEffort: 'max' });
    expect(p.decision.decisionSource).toBe('manual');
  });

  it('uses the model Claude Code reports, with a [1m] suffix, as the current model', async () => {
    const p = await plan('Add a CSV export endpoint to the reports API', { observedModel: 'claude-opus-5-5[1m]' });
    expect(p.decision.reason).not.toMatch(/router error/);
  });

  it('records nothing to apply when the router is off', async () => {
    const p = await plan('Fix the bug', { settings: withMode(auto, 'off') });
    expect(p.shouldApply).toBe(false);
    expect(p.decision.status).toBe('skipped');
  });
});

describe('finishTurn', () => {
  it('marks a decision applied when every step answered with the chosen model', async () => {
    const p = await plan("Fix the typo in the word 'helo'");
    const state = router.newSession('s1');
    const { state: next, record } = router.finishTurn({
      state,
      plan: p,
      steps: [{ usage: usage('claude-haiku-5-5') }, { usage: usage('claude-haiku-5-5', { cache_read_input_tokens: 2000 }) }],
    });
    expect(record.decision).toMatchObject({ status: 'applied', appliedModel: 'claude-haiku-5-5', appliedEffort: 'low' });
    expect(record).toMatchObject({ verified: true, steps: 2, answeredBy: ['claude-haiku-5-5'] });
    expect(record.tokens).toEqual({ inputTokens: 2000, outputTokens: 1000, cacheReadTokens: 2000, cacheWriteTokens: 0 });
    // Prices of 2026-11-19, Haiku 0.1 in / 0.5 out / 0.01 cache read per million.
    expect(record.decision.estimatedCostUsd).toBeCloseTo(0.0002 + 0.0005 + 0.00002, 8);
    expect(next).toMatchObject({ currentModel: 'anthropic.claude-haiku', contextTokens: 3500, turns: 1 });
  });

  it('prices a turn when every rate is known', async () => {
    const p = await plan('Add a CSV export endpoint to the reports API');
    const { record } = router.finishTurn({ state: null, plan: p, steps: [{ usage: usage('claude-sonnet-5-5') }] });
    // Sonnet 2/10 per million: 1000 in + 500 out.
    expect(record.decision.estimatedCostUsd).toBeCloseTo(0.007, 6);
  });

  it('marks it failed when Claude Code answered with another model', async () => {
    const p = await plan("Fix the typo in the word 'helo'");
    const { state, record } = router.finishTurn({ state: router.newSession('s1'), plan: p, steps: [{ usage: usage('claude-opus-5-5') }] });
    expect(record.decision).toMatchObject({ status: 'failed', appliedModel: 'claude-opus-5-5', appliedEffort: null });
    // The session follows what really answered, not what was asked.
    expect(state.currentModel).toBe('anthropic.claude-opus');
  });

  it('leaves the status alone when no step reported usage', async () => {
    const p = await plan("Fix the typo in the word 'helo'");
    const { state, record } = router.finishTurn({ state: router.newSession('s1'), plan: p, steps: [] });
    expect(record).toMatchObject({ verified: false, answeredBy: [], steps: 0 });
    expect(record.decision).toMatchObject({ status: 'recommended', estimatedCostUsd: null });
    expect(state.contextTokens).toBeNull();
  });

  it('in shadow mode records what really answered without claiming it was applied', async () => {
    const p = await plan("Fix the typo in the word 'helo'", { settings: shadow });
    const { record } = router.finishTurn({ state: null, plan: p, steps: [{ usage: usage('claude-opus-5-5') }] });
    expect(record.decision).toMatchObject({ status: 'recommended', appliedModel: 'claude-opus-5-5', appliedEffort: null });
  });

  it('prices an unknown model as unknown, not zero', async () => {
    const p = await plan('Fix the bug');
    const { record } = router.finishTurn({ state: null, plan: p, steps: [{ usage: usage('some-future-model') }] });
    expect(record.decision.estimatedCostUsd).toBeNull();
  });

  it('a once-override survives a turn that never ran', async () => {
    const state = withOverride(router.newSession('s1'), { model: 'opus', scope: 'turn' });
    const p = await plan('Fix the bug', { state });
    const { state: next } = router.finishTurn({ state, plan: p, steps: [] });
    expect(next.override).toMatchObject({ model: 'opus', scope: 'turn' });
    expect(next.turns).toBe(1);
  });

  it('calls the cost unknown when a step reported no usage', async () => {
    const p = await plan('Add a CSV export endpoint to the reports API');
    const { record } = router.finishTurn({ state: null, plan: p, steps: [{ usage: usage('claude-sonnet-5-5') }, { usage: null }] });
    expect(record.decision.estimatedCostUsd).toBeNull();
    expect(record.costComplete).toBe(false);
  });

  it('a once-override is gone after the turn; /clear empties the context', async () => {
    const state = withOverride(router.newSession('s1'), { model: 'opus', scope: 'turn' });
    const p = await plan('Fix the bug', { state });
    const { state: next } = router.finishTurn({ state, plan: p, steps: [{ usage: usage('claude-opus-5-5') }] });
    expect(next.override).toBeNull();
    expect(afterClear(next).contextTokens).toBe(0);
  });
});

describe('decideSubagent', () => {
  const spawn = (extra) =>
    router.decideSubagent({
      settings: auto,
      sessionId: 's1',
      prompt: 'Fix the typo in README.md',
      subagentType: 'general-purpose',
      ids: { decisionId: 'sub1', turnId: null },
      createdAt: CREATED,
      ...extra,
    });

  it('routes a subagent by its task', () => {
    expect(spawn()).toMatchObject({ shouldApply: true, agentModel: 'haiku' });
    expect(spawn({ prompt: 'Design the architecture for a multi-tenant billing service' }).agentModel).toBe('opus');
    expect(spawn().decision.subagentId).toBe('sub1');
  });

  it('respects a model the call names, forks and off mode', () => {
    expect(spawn({ model: 'sonnet' })).toMatchObject({ decision: null, skipReason: 'the call names its own model' });
    expect(spawn({ subagentType: 'fork' }).skipReason).toMatch(/fork/);
    expect(spawn({ settings: withMode(auto, 'off') }).skipReason).toBe('router is off');
  });

  it('only recommends in shadow mode', () => {
    expect(spawn({ settings: shadow })).toMatchObject({ shouldApply: false, agentModel: null });
  });
});

describe('AI classifier through the session', () => {
  const hybrid = settingsFromOptions({ privacyMode: 'cloud-ai', aiClassifier: 'on' }).settings;
  const answer = JSON.stringify({
    taskType: 'architecture',
    complexity: 0.9,
    reasoning: 'high',
    codingDepth: 'medium',
    risk: 'medium',
    scope: 'multi_module',
    confidence: 0.9,
    latencyPriority: false,
  });

  it('asks haiku at low effort with the configured timeout, for an unclear prompt', async () => {
    const complete = vi.fn().mockResolvedValue(answer);
    const result = await router.classify({ text: 'hello there', state: router.newSession('s1'), settings: hybrid, complete });
    expect(result.source).toBe('classifier-ai');
    expect(complete.mock.calls[0][0]).toMatchObject({ model: 'haiku', effort: 'low', maxTokens: 300, timeoutMs: 3000 });
  });

  it('never asks in local-only mode', async () => {
    const complete = vi.fn();
    await router.classify({ text: 'hello there', state: router.newSession('s1'), settings: shadow, complete });
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('manual model names', () => {
  it('lists and resolves the models Claude Code can run', () => {
    expect(router.manualModels().map((m) => m.name)).toEqual(['haiku', 'sonnet', 'opus']);
    expect(router.resolveManual('claude-opus-5-5').id).toBe('anthropic.claude-opus');
    // Fable is in the registry but disabled by default.
    expect(router.resolveManual('fable')).toBeNull();
    expect(router.modelIdOf('')).toBeNull();
  });
});
