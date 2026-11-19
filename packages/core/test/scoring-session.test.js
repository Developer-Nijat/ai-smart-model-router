'use strict';

const {
  requiredTier,
  qualityFit,
  transitionCost,
  scoreCandidates,
  createSessionState,
  withOverride,
  withContext,
  afterDecision,
  afterClear,
  contextUtilization,
  contextLoad,
} = require('../src');
const { registry } = require('./fixtures');

const base = { complexity: 0.5, reasoning: 'medium', risk: 'low', latencyPriority: false };
const WEIGHTS = { quality: 1, cost: 0.3, latency: 0.1, transition: 0.5 };

describe('scoring', () => {
  it('needs a higher tier for complex, high-reasoning, high-risk work', () => {
    expect(requiredTier({ ...base, complexity: 0 })).toBe(1);
    expect(requiredTier(base)).toBeCloseTo(2.1);
    expect(requiredTier({ ...base, reasoning: 'high', risk: 'high' })).toBeCloseTo(2.9);
    expect(requiredTier({ complexity: 1, reasoning: 'high', risk: 'high' })).toBe(4);
  });

  it('penalises under-powered models far more than over-powered ones', () => {
    expect(qualityFit(2, 2)).toBe(1);
    expect(qualityFit(3, 2)).toBeCloseTo(0.95);
    expect(qualityFit(2, 2.4)).toBeCloseTo(0.88);
    expect(qualityFit(1, 3)).toBeCloseTo(0);
    expect(qualityFit(1, 2)).toBeCloseTo(0.5);
  });

  it('charges a switch by context size, nothing to stay or start', () => {
    expect(transitionCost(null, 'a', 1)).toBe(0);
    expect(transitionCost('a', 'a', 1)).toBe(0);
    expect(transitionCost('a', 'b', null)).toBe(0.3);
    expect(transitionCost('a', 'b', 0)).toBe(0);
    expect(transitionCost('a', 'b', 0.4)).toBe(0.4);
    expect(transitionCost('a', 'b', 1)).toBe(1);
    // Priced: re-reading on a cheap model costs less, never below the floor.
    expect(transitionCost('a', 'b', 0.4, 0.5)).toBeCloseTo(0.2);
    expect(transitionCost('a', 'b', 0.4, 0.01)).toBeCloseTo(0.1);
    expect(transitionCost('a', 'b', null, 0.5)).toBeCloseTo(0.15);
  });

  it('ranks candidates and skips models without a tier', () => {
    const models = [...registry().candidatesFor('claude-code'), { id: 'x.untiered', tier: null }];
    const costs = { 'acme.small': 0.2, 'acme.mid': 0.6, 'acme.big': 1 };
    const scored = scoreCandidates({ candidates: models, classification: base, weights: WEIGHTS, costs, currentId: null, contextLoad: null });
    expect(scored.map((s) => s.model.id)).toEqual(['acme.mid', 'acme.big', 'acme.small']);
    expect(scored[0].parts).toEqual({ quality: 0.97, cost: 0.6, latency: 0.667, transition: 0 });
    expect(scoreCandidates({ candidates: [], classification: base, weights: WEIGHTS, costs, currentId: null, contextLoad: null })).toEqual([]);
  });

  it('doubles the latency weight when speed is asked for, and can exempt strong models from switch cost', () => {
    const models = registry().candidatesFor('claude-code');
    const costs = { 'acme.small': 0, 'acme.mid': 0, 'acme.big': 0 };
    const input = { candidates: models, weights: WEIGHTS, costs, currentId: 'acme.small', contextLoad: 1 };
    const normal = scoreCandidates({ ...input, classification: base });
    const urgent = scoreCandidates({ ...input, classification: { ...base, latencyPriority: true } });
    const big = (list) => list.find((s) => s.model.id === 'acme.big');
    expect(big(urgent).score).toBeLessThan(big(normal).score);
    const exempt = scoreCandidates({ ...input, classification: base, exemptFromTransitionAtTier: 3 });
    expect(big(exempt).parts.transition).toBe(0);
    // Free models here: the switch cost is the floor share of the full context load.
    expect(exempt.find((s) => s.model.id === 'acme.mid').parts.transition).toBe(0.25);
  });
});

describe('session state', () => {
  it('starts empty and validates its input', () => {
    const s = createSessionState({ sessionId: 's', agentId: 'claude-code' });
    expect(s).toEqual({ sessionId: 's', agentId: 'claude-code', subagentId: null, currentModel: null, contextTokens: null, override: null, turns: 0, lastDecisionId: null });
    expect(Object.isFrozen(s)).toBe(true);
    expect(() => createSessionState({ sessionId: 's' })).toThrow(TypeError);
    expect(() => createSessionState()).toThrow(TypeError);
  });

  it('never mutates: each change is a new state (AC-5)', () => {
    const a = createSessionState({ sessionId: 'a', agentId: 'claude-code' });
    const b = withOverride(a, { model: 'big' });
    expect(a.override).toBeNull();
    expect(b.override).toEqual({ model: 'big', effort: null, scope: 'session' });
    expect(withOverride(b, null).override).toBeNull();
    expect(() => withOverride(a, {})).toThrow(TypeError);
  });

  it('moves the current model only when the adapter applied the decision', () => {
    const s = withOverride(createSessionState({ sessionId: 's', agentId: 'x', currentModel: 'acme.mid' }), { model: 'big', scope: 'turn' });
    const decision = { id: 'd-9', selection: { model: 'acme.big' } };
    const recommended = afterDecision(s, decision, false);
    expect(recommended).toMatchObject({ currentModel: 'acme.mid', override: null, turns: 1, lastDecisionId: 'd-9' });
    expect(afterDecision(s, decision, true).currentModel).toBe('acme.big');
    const sticky = withOverride(s, { model: 'big', scope: 'session' });
    expect(afterDecision(sticky, decision, true).override.model).toBe('big');
  });

  it('tracks context size and clears it', () => {
    const s = withContext(createSessionState({ sessionId: 's', agentId: 'x' }), 100_000);
    const model = registry().get('acme.small');
    expect(contextUtilization(s, model)).toBe(0.5);
    expect(contextUtilization(s, { contextWindow: null })).toBeNull();
    expect(contextLoad(s)).toBe(0.5);
    expect(contextLoad(withContext(s, 900_000))).toBe(1);
    expect(withContext(s, -5).contextTokens).toBeNull();
    expect(contextLoad(withContext(s, null))).toBeNull();
    expect(afterClear(s).contextTokens).toBe(0);
    expect(contextUtilization(withContext(s, null), model)).toBeNull();
  });
});
