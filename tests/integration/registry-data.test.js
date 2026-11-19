'use strict';

const { createRegistry, decide, createSessionState, compileRules } = require('@smr/core');
const { loadRegistryData, loadRules, defaultSettings } = require('@smr/config');

const registry = createRegistry(loadRegistryData());
const agent = { id: 'claude-code', capabilities: { turnLevelRouting: true, effortControl: true } };
const auto = { ...defaultSettings(), routing: { ...defaultSettings().routing, mode: 'auto' } };

function route(text) {
  return decide({
    ids: { decisionId: 'd' },
    createdAt: '2026-11-19T10:00:00.000Z',
    agent,
    settings: auto,
    registry,
    rules: compileRules(loadRules()),
    session: createSessionState({ sessionId: 's', agentId: 'claude-code' }),
    text,
  }).decision;
}

describe('shipped registry data', () => {
  it('loads and validates', () => {
    expect(registry.models().length).toBeGreaterThanOrEqual(3);
  });

  it('gives every priced model a source and date (ADR-008)', () => {
    for (const model of registry.models()) {
      const price = registry.pricingFor(model.id);
      if (price) {
        expect(price.sourceUrl).toMatch(/^https:\/\//);
        expect(price.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('maps Claude Code aliases verified in the spike', () => {
    expect(registry.agentModelId('anthropic.claude-haiku', 'claude-code')).toBe('haiku');
    expect(registry.agentModelId('anthropic.claude-sonnet', 'claude-code')).toBe('sonnet');
    expect(registry.agentModelId('anthropic.claude-opus', 'claude-code')).toBe('opus');
    expect(registry.fromAgentModelName('claude-code', 'claude-opus-5-5').id).toBe('anthropic.claude-opus');
  });

  it('keeps Fable out of automatic routing until enabled', () => {
    expect(registry.candidatesFor('claude-code').map((m) => m.id)).not.toContain('anthropic.claude-fable');
  });

  it.each([
    ['Fix the small typo in the README', 'anthropic.claude-haiku'],
    ['README-də yazım səhvini düzəlt', 'anthropic.claude-haiku'],
    ['Add a /health endpoint to the express server', 'anthropic.claude-sonnet'],
    ['Fix the bug where login fails with 500', 'anthropic.claude-sonnet'],
    ['Review the auth flow for security vulnerabilities and CSRF', 'anthropic.claude-opus'],
    ['Design the architecture for splitting the monolith into microservices', 'anthropic.claude-opus'],
    ['Ödəniş modulunda təhlükəsizlik zəifliklərini araşdır', 'anthropic.claude-opus'],
  ])('routes "%s" to %s', (text, model) => {
    expect(route(text).selection.model).toBe(model);
  });
});
