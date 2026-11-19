'use strict';

const { ValidationError } = require('@smr/shared');
const { createRegistry } = require('../src');
const { DATA, registry } = require('./fixtures');

describe('createRegistry', () => {
  it('resolves ids and aliases case-insensitively', () => {
    const r = registry();
    expect(r.get('acme.mid').displayName).toBe('Mid');
    expect(r.get('nope')).toBeNull();
    expect(r.resolve('SMALL').id).toBe('acme.small');
    expect(r.resolve('acme-small-1').id).toBe('acme.small');
    expect(r.resolve('acme.big').id).toBe('acme.big');
    expect(r.resolve('')).toBeNull();
    expect(r.resolve(42)).toBeNull();
  });

  it('lists only enabled models of enabled providers that the agent can run, weakest first', () => {
    const r = registry();
    expect(r.candidatesFor('claude-code').map((m) => m.id)).toEqual(['acme.small', 'acme.mid', 'acme.big']);
    expect(r.candidatesFor('other').map((m) => m.id)).toEqual(['acme.small']);
    expect(r.candidatesFor('unknown-agent')).toEqual([]);
    expect(r.isUsable(r.get('acme.off'))).toBe(false);
    expect(r.isUsable(null)).toBe(false);
  });

  it('maps between registry ids and agent model names', () => {
    const r = registry();
    expect(r.agentModelId('acme.mid', 'claude-code')).toBe('mid');
    expect(r.agentModelId('acme.mid', 'other')).toBeNull();
    expect(r.agentModelId('nope', 'claude-code')).toBeNull();
    expect(r.fromAgentModelName('other', 'small-x').id).toBe('acme.small');
    expect(r.fromAgentModelName('claude-code', 'acme-small-1').id).toBe('acme.small');
    expect(r.fromAgentModelName('claude-code', 'unknown')).toBeNull();
    expect(r.fromAgentModelName('claude-code', undefined)).toBeNull();
  });

  it('returns the price in force on a date, else the newest', () => {
    const r = createRegistry({
      ...DATA,
      pricing: [
        ...DATA.pricing,
        { modelId: 'acme.small', inputPerMillion: 2, outputPerMillion: 6, sourceUrl: 'https://example.com/p', asOf: '2026-06-01' },
      ],
    });
    expect(r.pricingFor('acme.small').inputPerMillion).toBe(2);
    expect(r.pricingFor('acme.small', '2026-03-01').inputPerMillion).toBe(1);
    expect(r.pricingFor('acme.small', '2025-01-01')).toBeNull();
    expect(r.pricingFor('acme.off')).toBeNull();
  });

  it('is deeply frozen', () => {
    const r = registry();
    expect(Object.isFrozen(r.get('acme.mid').capabilities)).toBe(true);
    expect(Object.isFrozen(r.models())).toBe(true);
  });

  it('refuses inconsistent data', () => {
    const bad = (patch) => () => createRegistry({ ...DATA, ...patch });
    expect(bad({ models: [...DATA.models, DATA.models[0]] })).toThrow(/Duplicate model id/);
    expect(bad({ providers: [...DATA.providers, DATA.providers[0]] })).toThrow(/Duplicate provider id/);
    expect(bad({ models: [{ ...DATA.models[0], provider: 'ghost' }] })).toThrow(/unknown provider/);
    expect(bad({ models: [DATA.models[0], { ...DATA.models[1], aliases: ['small'] }] })).toThrow(/used by both/);
    expect(bad({ pricing: [{ ...DATA.pricing[0], modelId: 'acme.ghost' }] })).toThrow(/unknown model/);
    expect(bad({ pricing: [DATA.pricing[0], DATA.pricing[0]] })).toThrow(/Two prices/);
    expect(bad({ models: [{ id: 'x' }] })).toThrow(ValidationError);
  });

  it('accepts empty data', () => {
    expect(createRegistry().models()).toEqual([]);
  });
});
