'use strict';

const {
  ModelSchema,
  PricingSchema,
  RoutingRuleSchema,
  RoutingDecisionSchema,
  ClassificationSchema,
  AgentCapabilitiesSchema,
  AgentInfoSchema,
  SettingsSchema,
  parseOrThrow,
  ValidationError,
} = require('../src');

describe('ModelSchema', () => {
  it('fills safe defaults and keeps unknown numbers null', () => {
    const model = ModelSchema.parse({
      id: 'anthropic.claude-sonnet',
      provider: 'anthropic',
      displayName: 'Claude Sonnet',
    });
    expect(model.contextWindow).toBeNull();
    expect(model.capabilities).toEqual({ coding: false, reasoning: false, vision: false, toolUse: false });
    expect(model.supportedEffort).toEqual([]);
    expect(model.status).toBe('enabled');
  });

  it('rejects an id without a provider prefix', () => {
    expect(ModelSchema.safeParse({ id: 'sonnet', provider: 'anthropic', displayName: 'x' }).success).toBe(false);
  });

  it('rejects an unknown effort level', () => {
    const result = ModelSchema.safeParse({
      id: 'anthropic.claude-sonnet',
      provider: 'anthropic',
      displayName: 'x',
      supportedEffort: ['extreme'],
    });
    expect(result.success).toBe(false);
  });
});

describe('PricingSchema', () => {
  const base = { modelId: 'anthropic.claude-sonnet', sourceUrl: 'https://example.com/pricing', asOf: '2026-11-01' };

  it('accepts null prices when the source and date are given', () => {
    const pricing = PricingSchema.parse(base);
    expect(pricing.inputPerMillion).toBeNull();
    expect(pricing.currency).toBe('USD');
  });

  it('requires a source url and a date', () => {
    expect(PricingSchema.safeParse({ modelId: base.modelId }).success).toBe(false);
    expect(PricingSchema.safeParse({ ...base, asOf: 'yesterday' }).success).toBe(false);
  });

  it('refuses a non-https source and negative prices', () => {
    expect(PricingSchema.safeParse({ ...base, sourceUrl: 'http://example.com' }).success).toBe(false);
    expect(PricingSchema.safeParse({ ...base, inputPerMillion: -1 }).success).toBe(false);
  });
});

describe('RoutingRuleSchema', () => {
  const rule = {
    id: 'security-to-opus',
    name: 'Security goes to the strongest model',
    when: { taskTypes: ['security'] },
    then: { model: 'anthropic.claude-opus', effort: 'high' },
  };

  it('accepts a valid rule and defaults priority and enabled', () => {
    const parsed = RoutingRuleSchema.parse(rule);
    expect(parsed.priority).toBe(0);
    expect(parsed.enabled).toBe(true);
  });

  it('rejects a rule with no condition or no action', () => {
    expect(RoutingRuleSchema.safeParse({ ...rule, when: {} }).success).toBe(false);
    expect(RoutingRuleSchema.safeParse({ ...rule, then: {} }).success).toBe(false);
  });

  it('rejects an inverted complexity range and unknown keys', () => {
    expect(
      RoutingRuleSchema.safeParse({ ...rule, when: { minComplexity: 0.8, maxComplexity: 0.2 } }).success,
    ).toBe(false);
    expect(RoutingRuleSchema.safeParse({ ...rule, when: { taskType: 'security' } }).success).toBe(false);
  });
});

describe('ClassificationSchema', () => {
  it('bounds scores to 0..1', () => {
    const base = {
      taskType: 'bug_fix',
      complexity: 0.5,
      reasoning: 'medium',
      codingDepth: 'low',
      risk: 'low',
      scope: 'single_file',
      confidence: 0.9,
    };
    expect(ClassificationSchema.parse(base).latencyPriority).toBe(false);
    expect(ClassificationSchema.safeParse({ ...base, complexity: 1.2 }).success).toBe(false);
  });
});

describe('RoutingDecisionSchema', () => {
  const decision = {
    id: 'd-1',
    sessionId: 's-1',
    agentId: 'claude-code',
    mode: 'shadow',
    selection: { model: 'anthropic.claude-sonnet' },
    reason: 'no rule matched',
    decisionSource: 'default',
    status: 'recommended',
    createdAt: '2026-11-18T09:00:00Z',
  };

  it('accepts a minimal decision with nullable defaults', () => {
    const parsed = RoutingDecisionSchema.parse(decision);
    expect(parsed.turnId).toBeNull();
    expect(parsed.selection.effort).toBeNull();
    expect(parsed.alternatives).toEqual([]);
  });

  it('rejects an unknown status or source', () => {
    expect(RoutingDecisionSchema.safeParse({ ...decision, status: 'done' }).success).toBe(false);
    expect(RoutingDecisionSchema.safeParse({ ...decision, decisionSource: 'magic' }).success).toBe(false);
  });
});

describe('AgentCapabilitiesSchema', () => {
  it('defaults every capability to false', () => {
    const caps = AgentCapabilitiesSchema.parse({});
    expect(Object.values(caps).every((value) => value === false)).toBe(true);
  });

  it('rejects an unknown capability', () => {
    expect(AgentCapabilitiesSchema.safeParse({ teleport: true }).success).toBe(false);
  });

  it('gives AgentInfo all-false capabilities by default', () => {
    const info = AgentInfoSchema.parse({ id: 'codex', displayName: 'Codex', installed: false });
    expect(info.capabilities.turnLevelRouting).toBe(false);
    expect(info.version).toBeNull();
  });
});

describe('SettingsSchema', () => {
  it('produces safe defaults from an empty object', () => {
    const settings = SettingsSchema.parse({});
    expect(settings.routing.mode).toBe('shadow');
    expect(settings.privacy).toEqual({ mode: 'local-only', storePrompts: false });
    expect(settings.classifier.enabled).toBe(false);
    expect(settings.server.host).toBe('127.0.0.1');
    expect(settings.routing.weights.quality).toBe(1);
  });

  it('keeps nested defaults when only part of a section is given', () => {
    const settings = SettingsSchema.parse({ routing: { mode: 'auto' } });
    expect(settings.routing.mode).toBe('auto');
    expect(settings.routing.sticky.enabled).toBe(true);
  });

  it('refuses a non-loopback host and unknown keys', () => {
    expect(SettingsSchema.safeParse({ server: { host: '0.0.0.0' } }).success).toBe(false);
    expect(SettingsSchema.safeParse({ telemetry: true }).success).toBe(false);
  });
});

describe('parseOrThrow', () => {
  it('returns parsed data', () => {
    expect(parseOrThrow(SettingsSchema, {}, 'settings').version).toBe(1);
  });

  it('throws ValidationError with readable issues', () => {
    let caught;
    try {
      parseOrThrow(SettingsSchema, { server: { port: 80 } }, 'settings');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught.code).toBe('E_VALIDATION');
    expect(caught.issues[0]).toMatch(/^server\.port: /);
    expect(caught.message).toMatch(/^Invalid settings: /);
  });

  it('labels a root-level issue', () => {
    expect(() => parseOrThrow(SettingsSchema, 'nope', 'settings')).toThrow(/\(root\)/);
  });
});
