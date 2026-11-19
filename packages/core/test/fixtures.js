'use strict';

const { SettingsSchema } = require('@smr/shared');
const { createRegistry } = require('../src/registry');
const { createSessionState } = require('../src/session');

/** Test models with invented prices: never used outside tests. */
const DATA = Object.freeze({
  providers: [
    { id: 'acme', displayName: 'Acme', kind: 'cloud' },
    { id: 'offline', displayName: 'Offline', kind: 'local', status: 'disabled' },
  ],
  models: [
    {
      id: 'acme.small',
      provider: 'acme',
      displayName: 'Small',
      aliases: ['small', 'acme-small-1'],
      tier: 1,
      supportedEffort: ['low', 'medium', 'high'],
      contextWindow: 200000,
      agentModelIds: { 'claude-code': 'small', other: 'small-x' },
    },
    {
      id: 'acme.mid',
      provider: 'acme',
      displayName: 'Mid',
      aliases: ['mid'],
      tier: 2,
      supportedEffort: ['low', 'medium', 'high', 'xhigh', 'max'],
      contextWindow: 1000000,
      agentModelIds: { 'claude-code': 'mid' },
    },
    {
      id: 'acme.big',
      provider: 'acme',
      displayName: 'Big',
      aliases: ['big'],
      tier: 3,
      supportedEffort: ['low', 'medium', 'high', 'xhigh', 'max'],
      contextWindow: 1000000,
      agentModelIds: { 'claude-code': 'big' },
    },
    {
      id: 'acme.off',
      provider: 'acme',
      displayName: 'Disabled',
      tier: 4,
      agentModelIds: { 'claude-code': 'off' },
      status: 'disabled',
    },
    { id: 'offline.local', provider: 'offline', displayName: 'Local', tier: 1, agentModelIds: { 'claude-code': 'local' } },
  ],
  pricing: [
    { modelId: 'acme.small', inputPerMillion: 1, outputPerMillion: 5, sourceUrl: 'https://example.com/p', asOf: '2026-01-01' },
    { modelId: 'acme.mid', inputPerMillion: 3, outputPerMillion: 15, sourceUrl: 'https://example.com/p', asOf: '2026-01-01' },
    { modelId: 'acme.big', inputPerMillion: 5, outputPerMillion: 25, sourceUrl: 'https://example.com/p', asOf: '2026-01-01' },
  ],
});

function registry(overrides = {}) {
  return createRegistry({ ...DATA, ...overrides });
}

function settings(patch = {}) {
  const base = SettingsSchema.parse({});
  return SettingsSchema.parse({
    ...base,
    ...patch,
    routing: { ...base.routing, ...(patch.routing ?? {}) },
    classifier: { ...base.classifier, ...(patch.classifier ?? {}) },
    privacy: { ...base.privacy, ...(patch.privacy ?? {}) },
  });
}

const CLAUDE_CODE = Object.freeze({
  id: 'claude-code',
  capabilities: Object.freeze({ turnLevelRouting: true, effortControl: true, subagentRouting: true }),
});

function session(patch = {}) {
  const base = createSessionState({ sessionId: 's-1', agentId: 'claude-code', ...patch });
  return Object.freeze({ ...base, ...patch });
}

/** A full decide() input with sensible defaults. */
function decideInput(patch = {}) {
  return {
    ids: { decisionId: 'd-1', turnId: 't-1' },
    createdAt: '2026-11-19T10:00:00.000Z',
    agent: CLAUDE_CODE,
    settings: settings({ routing: { mode: 'auto' } }),
    registry: registry(),
    rules: [],
    session: session(),
    text: 'Add a /health endpoint to the server',
    ...patch,
  };
}

module.exports = { DATA, registry, settings, session, decideInput, CLAUDE_CODE };
