'use strict';

const { compileRules, evaluateRules, desiredEffort, clampEffort, estimateCostUsd, relativeCosts } = require('../src');
const { registry } = require('./fixtures');

const C = Object.freeze({
  taskType: 'security',
  complexity: 0.7,
  reasoning: 'high',
  codingDepth: 'medium',
  risk: 'high',
  scope: 'single_file',
  confidence: 0.9,
  latencyPriority: false,
  contextTokens: null,
});

const rule = (id, when, then, priority = 0, enabled = true) => ({ id, name: id, when, then, priority, enabled });

describe('compileRules', () => {
  it('drops disabled rules and orders by priority, then id', () => {
    const compiled = compileRules([
      rule('b', { taskTypes: ['ui'] }, { effort: 'low' }, 5),
      rule('a', { taskTypes: ['ui'] }, { effort: 'low' }, 5),
      rule('z', { taskTypes: ['ui'] }, { effort: 'low' }, 9),
      rule('off', { taskTypes: ['ui'] }, { effort: 'low' }, 99, false),
    ]);
    expect(compiled.map((r) => r.id)).toEqual(['z', 'a', 'b']);
    expect(Object.isFrozen(compiled[0].when)).toBe(true);
  });

  it('refuses invalid or duplicate rules', () => {
    expect(() => compileRules([{ id: 'x' }])).toThrow(/routing rule #1/);
    expect(() => compileRules([rule('a', { taskTypes: ['ui'] }, { effort: 'low' }), rule('a', { taskTypes: ['ui'] }, { effort: 'low' })])).toThrow(/Duplicate/);
    expect(compileRules()).toEqual([]);
  });
});

describe('evaluateRules', () => {
  it('requires every condition of a rule to hold', () => {
    const compiled = compileRules([rule('r', { taskTypes: ['security'], risk: ['high'], agents: ['claude-code'] }, { model: 'acme.big' })]);
    expect(evaluateRules(compiled, { classification: C, agentId: 'claude-code' }).model).toEqual({ value: 'acme.big', ruleId: 'r' });
    expect(evaluateRules(compiled, { classification: C, agentId: 'codex' }).model).toBeNull();
    expect(evaluateRules(compiled, { classification: { ...C, risk: 'low' }, agentId: 'claude-code' }).matched).toEqual([]);
  });

  it('matches keywords case-insensitively and complexity ranges inclusively', () => {
    const compiled = compileRules([
      rule('kw', { keywords: ['Migration'] }, { effort: 'high' }),
      rule('range', { minComplexity: 0.7, maxComplexity: 0.7 }, { effort: 'max' }, -1),
    ]);
    const result = evaluateRules(compiled, { classification: C, agentId: 'x', text: 'run the MIGRATION' });
    expect(result.matched).toEqual(['kw', 'range']);
    expect(result.effort).toEqual({ value: 'high', ruleId: 'kw' });
    expect(evaluateRules(compiled, { classification: { ...C, complexity: 0.71 }, agentId: 'x' }).matched).toEqual([]);
    expect(evaluateRules(compiled, { classification: { ...C, complexity: 0.69 }, agentId: 'x' }).matched).toEqual([]);
  });

  it('lets the highest-priority rule win each action; lower rules fill the rest', () => {
    const compiled = compileRules([
      rule('low', { taskTypes: ['security'] }, { model: 'acme.mid', effort: 'low', avoidModelSwitch: true }, 1),
      rule('high', { taskTypes: ['security'] }, { model: 'acme.big' }, 10),
    ]);
    const result = evaluateRules(compiled, { classification: C, agentId: 'x' });
    expect(result.model.ruleId).toBe('high');
    expect(result.effort.ruleId).toBe('low');
    expect(result.avoidModelSwitch).toEqual({ value: true, ruleId: 'low' });
  });

  it('still skips disabled rules and orders by priority when given raw rules', () => {
    const raw = [
      rule('low', { taskTypes: ['security'] }, { model: 'acme.mid' }, 1),
      rule('off', { taskTypes: ['security'] }, { model: 'acme.small' }, 99, false),
      rule('high', { taskTypes: ['security'] }, { model: 'acme.big' }, 10),
    ];
    expect(evaluateRules(raw, { classification: C, agentId: 'x' }).model.ruleId).toBe('high');
  });

  it('matches keywords across the Azerbaijani dotted İ', () => {
    const compiled = compileRules([rule('az', { keywords: ['işləmir'] }, { effort: 'high' })]);
    expect(evaluateRules(compiled, { classification: C, agentId: 'x', text: 'LOGİN İŞLƏMİR' }).matched).toEqual(['az']);
  });

  it('never matches context utilization when it is unknown', () => {
    const compiled = compileRules([rule('ctx', { contextUtilizationAbove: 0.8 }, { avoidModelSwitch: true })]);
    expect(evaluateRules(compiled, { classification: C, agentId: 'x' }).matched).toEqual([]);
    expect(evaluateRules(compiled, { classification: C, agentId: 'x', contextUtilization: 0.8 }).matched).toEqual([]);
    expect(evaluateRules(compiled, { classification: C, agentId: 'x', contextUtilization: 0.81 }).matched).toEqual(['ctx']);
  });
});

describe('effort', () => {
  it('maps reasoning to effort, xhigh only for high reasoning plus risk or complexity', () => {
    expect(desiredEffort({ ...C, reasoning: 'low' })).toBe('low');
    expect(desiredEffort({ ...C, reasoning: 'medium' })).toBe('medium');
    expect(desiredEffort({ ...C, risk: 'low', complexity: 0.7 })).toBe('high');
    expect(desiredEffort({ ...C, risk: 'low', complexity: 0.9 })).toBe('xhigh');
    expect(desiredEffort(C)).toBe('xhigh');
  });

  it('clamps to the levels a model supports (AC-4)', () => {
    expect(clampEffort('max', ['low', 'medium', 'high'])).toEqual({ effort: 'high', clamped: true });
    expect(clampEffort('high', ['low', 'high'])).toEqual({ effort: 'high', clamped: false });
    expect(clampEffort('medium', ['low', 'high'])).toEqual({ effort: 'low', clamped: true });
    expect(clampEffort('low', ['high', 'max'])).toEqual({ effort: 'high', clamped: true });
    expect(clampEffort('high', [])).toEqual({ effort: null, clamped: true });
    expect(clampEffort(null, ['low'])).toEqual({ effort: null, clamped: false });
  });
});

describe('cost', () => {
  const price = {
    inputPerMillion: 2,
    outputPerMillion: 10,
    cacheReadPerMillion: 0.1,
    cacheWritePerMillion: null,
    longContext: { thresholdTokens: 100000, inputPerMillion: 4, outputPerMillion: 20 },
  };

  it('prices real usage from a dated record', () => {
    expect(estimateCostUsd({ inputTokens: 50_000, outputTokens: 10_000, cacheReadTokens: 40_000 }, price)).toBe(0.204);
  });

  it('switches to long-context rates above the threshold, counting cached tokens as prompt', () => {
    expect(estimateCostUsd({ inputTokens: 200_000, outputTokens: 0 }, price)).toBe(0.8);
    expect(estimateCostUsd({ inputTokens: 50_000, outputTokens: 10_000, cacheReadTokens: 1_000_000 }, price)).toBe(0.5);
  });

  it('uses long-context cache rates when the record lists them', () => {
    const haiku = {
      inputPerMillion: 0.1,
      outputPerMillion: 0.5,
      cacheReadPerMillion: 0.01,
      cacheWritePerMillion: 0.125,
      longContext: { thresholdTokens: 100000, inputPerMillion: 0.5, outputPerMillion: 2.5, cacheReadPerMillion: 0.05, cacheWritePerMillion: 0.625 },
    };
    // Below: 0.1·0.01 + 0.01·0.125 (per M) on 10K read + 10K write.
    expect(estimateCostUsd({ cacheReadTokens: 10_000, cacheWriteTokens: 10_000 }, haiku)).toBeCloseTo(0.00135, 8);
    // Above 100K of prompt: 100K read at 0.05 + 10K write at 0.625.
    expect(estimateCostUsd({ cacheReadTokens: 100_000, cacheWriteTokens: 10_000 }, haiku)).toBeCloseTo(0.01125, 8);
  });

  it('refuses invalid token counts instead of pricing them', () => {
    expect(estimateCostUsd({ inputTokens: Number.NaN }, price)).toBeNull();
    expect(estimateCostUsd({ outputTokens: -5 }, price)).toBeNull();
    expect(estimateCostUsd(undefined, price)).toBe(0);
  });

  it('never prices an unknown rate as zero', () => {
    expect(estimateCostUsd({ inputTokens: 10, cacheWriteTokens: 5 }, price)).toBeNull();
    expect(estimateCostUsd({ inputTokens: 10 }, null)).toBeNull();
    expect(estimateCostUsd({}, price)).toBe(0);
  });

  it('compares candidates by blended price, else by tier for all alike', () => {
    const r = registry();
    const models = r.candidatesFor('claude-code');
    const priced = relativeCosts(models, (id) => r.pricingFor(id));
    expect(priced.basis).toBe('price');
    expect(priced.byModel['acme.big']).toBe(1);
    expect(priced.byModel['acme.small']).toBeCloseTo(0.2);

    const partial = relativeCosts(models, (id) => (id === 'acme.big' ? null : r.pricingFor(id)));
    expect(partial.basis).toBe('tier-proxy');
    expect(partial.byModel['acme.mid']).toBeCloseTo(2 / 3);
  });
});
