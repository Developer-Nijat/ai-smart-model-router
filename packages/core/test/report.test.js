'use strict';

const { costComparison, describeModels, modelIdOf } = require('../src/report');
const { registry } = require('./fixtures');

const row = (model, tokens, recordedAt = '2026-11-19T10:00:00.000Z') => ({
  model,
  recordedAt,
  tokens: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, ...tokens },
});

describe('costComparison', () => {
  it('prices each turn as answered and on every candidate model', () => {
    const result = costComparison(registry(), [row('small'), row('big[1m]')]);
    expect(result).toMatchObject({ turnsWithUsage: 2, comparedTurns: 2, excludedTurns: 0, actualUsd: 6 });
    expect(result.sameTokensOnlyOn['acme.small']).toBe(2);
    expect(result.sameTokensOnlyOn['acme.big']).toBe(10);
  });

  it('compares every figure over the same turns: any unknown price leaves the turn out of all', () => {
    // No cache price in the fixtures: a turn with cache reads has no known cost anywhere.
    const result = costComparison(registry(), [row('small'), row('small', { cacheReadTokens: 10 }), row('nobody-knows')]);
    expect(result).toMatchObject({ comparedTurns: 1, excludedTurns: 2, actualUsd: 1 });
    expect(result.sameTokensOnlyOn['acme.mid']).toBe(3);
  });

  it('gives null, not zero, when nothing can be compared', () => {
    expect(costComparison(registry(), [row('small', {}, '2025-01-01T00:00:00.000Z')])).toMatchObject({ comparedTurns: 0, excludedTurns: 1, actualUsd: null });
    expect(costComparison(registry(), []).actualUsd).toBeNull();
  });
});

describe('describeModels and modelIdOf', () => {
  it('lists models with the price in force on the day, or null', () => {
    const rows = describeModels(registry(), '2026-11-19');
    expect(rows.find((m) => m.id === 'acme.small')).toMatchObject({ claudeCode: 'small', status: 'enabled', price: { inputPerMillion: 1, asOf: '2026-01-01' } });
    expect(rows.find((m) => m.id === 'acme.off')).toMatchObject({ status: 'disabled', price: null });
    expect(describeModels(registry(), '2025-01-01').find((m) => m.id === 'acme.small').price).toBeNull();
  });

  it('maps reported model names, ignoring a context suffix', () => {
    expect(modelIdOf(registry(), 'mid[1m]')).toBe('acme.mid');
    expect(modelIdOf(registry(), 'unknown')).toBeNull();
  });
});
