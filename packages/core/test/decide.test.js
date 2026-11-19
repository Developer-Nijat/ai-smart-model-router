'use strict';

const { RoutingDecisionSchema } = require('@smr/shared');
const { decide, compileRules, withOverride, withContext, createSessionState } = require('../src');
const { decideInput, session, settings, registry, CLAUDE_CODE } = require('./fixtures');

const SECURITY = 'Audit the auth flow for injection vulnerabilities';
const TYPO = 'Fix the small typo in the readme';
const FEATURE = 'Add a /health endpoint to the server';

describe('decide: automatic routing', () => {
  it.each([
    [TYPO, 'acme.small'],
    [FEATURE, 'acme.mid'],
    [SECURITY, 'acme.big'],
  ])('%s → %s', (text, model) => {
    const { decision, shouldApply } = decide(decideInput({ text }));
    expect(decision.selection.model).toBe(model);
    expect(decision.decisionSource).toBe('classifier-rules');
    expect(shouldApply).toBe(true);
    expect(RoutingDecisionSchema.safeParse(decision).success).toBe(true);
  });

  it('keeps the prompt text out of the decision (AC-14)', () => {
    const text = 'Add a feature for customer ACME-SECRET-42';
    const { decision, trace } = decide(decideInput({ text }));
    expect(JSON.stringify(decision)).not.toContain('ACME-SECRET-42');
    expect(trace.join(' ')).not.toContain('ACME-SECRET-42');
  });

  it('lists the other candidates as scored alternatives', () => {
    const { decision } = decide(decideInput({ text: FEATURE }));
    expect(decision.alternatives.map((a) => a.model).sort()).toEqual(['acme.big', 'acme.small']);
    expect(decision.alternatives[0].reason).toMatch(/^quality /);
  });

  it('uses a classification the caller already made (e.g. by the AI classifier)', () => {
    const classified = {
      source: 'classifier-ai',
      classification: { taskType: 'architecture', complexity: 0.95, reasoning: 'high', codingDepth: 'high', risk: 'high', scope: 'multi_service', confidence: 0.9, latencyPriority: false, contextTokens: null },
    };
    const { decision } = decide(decideInput({ text: 'hello', classified }));
    expect(decision).toMatchObject({ decisionSource: 'classifier-ai', selection: { model: 'acme.big', effort: 'xhigh' } });
  });
});

describe('decide: modes (ADR-006)', () => {
  it('shadow mode recommends and never applies', () => {
    const { decision, shouldApply } = decide(decideInput({ settings: settings() }));
    expect(decision).toMatchObject({ mode: 'shadow', status: 'recommended' });
    expect(shouldApply).toBe(false);
  });

  it('off mode skips and keeps the current model', () => {
    const input = decideInput({ settings: settings({ routing: { mode: 'off' } }), session: session({ currentModel: 'acme.big' }) });
    const { decision, shouldApply, trace } = decide(input);
    expect(decision).toMatchObject({ status: 'skipped', selection: { model: 'acme.big' }, reason: 'router is off' });
    expect(shouldApply).toBe(false);
    expect(trace).toEqual([]);
  });

  it('off mode with no current model records the first candidate without applying', () => {
    const { decision, shouldApply } = decide(decideInput({ settings: settings({ routing: { mode: 'off' } }) }));
    expect(decision.selection.model).toBe('acme.small');
    expect(shouldApply).toBe(false);
  });
});

describe('decide: manual override (AC-3)', () => {
  it('beats rules and scoring, and applies even in shadow mode', () => {
    const rules = compileRules([{ id: 'sec', name: 'sec', when: { taskTypes: ['security'] }, then: { model: 'acme.big' } }]);
    const s = withOverride(session(), { model: 'small', effort: 'medium' });
    const { decision, shouldApply } = decide(decideInput({ text: SECURITY, rules, session: s, settings: settings() }));
    expect(decision).toMatchObject({ decisionSource: 'manual', selection: { model: 'acme.small', effort: 'medium' } });
    expect(shouldApply).toBe(true);
  });

  it('is ignored, with a trace, when the agent cannot run that model', () => {
    const s = withOverride(session(), { model: 'acme.off' });
    const { decision, trace } = decide(decideInput({ session: s }));
    expect(decision.decisionSource).not.toBe('manual');
    expect(trace.join('\n')).toMatch(/override acme\.off ignored/);
  });
});

describe('decide: rules', () => {
  it('a rule picks the model and its effort', () => {
    const rules = compileRules([{ id: 'ui-small', name: 'ui', when: { taskTypes: ['feature'] }, then: { model: 'acme.big', effort: 'low' } }]);
    const { decision } = decide(decideInput({ rules }));
    expect(decision).toMatchObject({ decisionSource: 'rule', selection: { model: 'acme.big', effort: 'low' } });
    expect(decision.reason).toMatch(/rule ui-small/);
    expect(decision.reason).toMatch(/effort by rule ui-small/);
  });

  it('a rule naming an unavailable model is ignored', () => {
    const rules = compileRules([{ id: 'ghost', name: 'g', when: { taskTypes: ['feature'] }, then: { model: 'acme.off' } }]);
    const { decision, trace } = decide(decideInput({ rules }));
    expect(decision.decisionSource).toBe('classifier-rules');
    expect(trace.join('\n')).toMatch(/rule ghost names acme\.off, not available/);
  });

  it('an effort-only rule changes effort, not the model', () => {
    const rules = compileRules([{ id: 'max', name: 'm', when: { taskTypes: ['feature'] }, then: { effort: 'max' } }]);
    const { decision } = decide(decideInput({ rules }));
    expect(decision.selection).toEqual({ model: 'acme.mid', effort: 'max' });
  });
});

describe('decide: effort (AC-4)', () => {
  it('is limited to what the chosen model supports', () => {
    const s = withOverride(session(), { model: 'small', effort: 'max' });
    const { decision, trace } = decide(decideInput({ session: s }));
    expect(decision.selection.effort).toBe('high');
    expect(decision.reason).toMatch(/effort max → high \(model limit\)/);
    expect(trace.join('\n')).toMatch(/model limit/);
  });

  it('is marked advisory when the agent cannot set effort', () => {
    const agent = { id: 'claude-code', capabilities: { turnLevelRouting: true } };
    const { trace } = decide(decideInput({ agent }));
    expect(trace.join('\n')).toMatch(/effort is advisory/);
  });

  it('is dropped for a model that takes none', () => {
    const r = registry({
      models: [{ id: 'acme.plain', provider: 'acme', displayName: 'Plain', tier: 2, agentModelIds: { 'claude-code': 'plain' } }],
      pricing: [],
    });
    const { decision } = decide(decideInput({ registry: r }));
    expect(decision.selection).toEqual({ model: 'acme.plain', effort: null });
    expect(decision.reason).toMatch(/takes no effort/);
  });
});

describe('decide: sticky routing (AC-6, AC-7)', () => {
  it('stays on the current model in a large context: the switch cost outweighs the gain', () => {
    const s = withContext(session({ currentModel: 'acme.big' }), 400_000);
    const { decision } = decide(decideInput({ text: FEATURE, session: s }));
    expect(decision).toMatchObject({ decisionSource: 'sticky', selection: { model: 'acme.big' } });
    expect(decision.reason).toMatch(/kept acme\.big: switching to acme\.mid would re-read the context/);
  });

  it('leaves an expensive model for a cheap one mid-session: re-reading is cheap there', () => {
    // A real /route test: a typo after an opus turn, ~73k tokens of context, stayed on opus.
    const s = withContext(session({ currentModel: 'acme.big' }), 72_600);
    const { decision } = decide(decideInput({ text: TYPO, session: s }));
    expect(decision.selection.model).toBe('acme.small');
    const big = decision.alternatives.find((a) => a.model === 'acme.big');
    expect(big).toBeDefined();
  });

  it('still charges the full switch cost for moving up to the dearest model', () => {
    const s = withContext(session({ currentModel: 'acme.small' }), 200_000);
    const { decision } = decide(decideInput({ text: FEATURE, session: s }));
    const big = decision.alternatives.find((a) => a.model === 'acme.big');
    expect(big.reason).toMatch(/switch 1$/);
  });

  it('switches after /clear (empty context) when the gain is clear', () => {
    const s = withContext(session({ currentModel: 'acme.big' }), 0);
    const { decision } = decide(decideInput({ text: TYPO, session: s }));
    expect(decision.selection.model).toBe('acme.small');
  });

  it('does not hold the model a session started on: minScoreGain needs an earlier routed turn', () => {
    const strict = settings({ routing: { mode: 'auto', sticky: { enabled: true, minScoreGain: 0.9 } } });
    const fresh = withContext(session({ currentModel: 'acme.small' }), 0);
    expect(decide(decideInput({ text: FEATURE, session: fresh, settings: strict })).decision.selection.model).toBe('acme.mid');
    const routed = { ...fresh, turns: 1 };
    expect(decide(decideInput({ text: FEATURE, session: routed, settings: strict })).decision).toMatchObject({ decisionSource: 'sticky', selection: { model: 'acme.small' } });
  });

  it('keeps the current model when a dearer one is better by less than minScoreGain', () => {
    const s = { ...withContext(session({ currentModel: 'acme.small' }), 0), turns: 1 };
    const strict = settings({ routing: { mode: 'auto', sticky: { enabled: true, minScoreGain: 0.9 } } });
    const { decision } = decide(decideInput({ text: FEATURE, session: s, settings: strict }));
    expect(decision).toMatchObject({ decisionSource: 'sticky', selection: { model: 'acme.small' } });
    expect(decision.reason).toMatch(/better by only/);
  });

  it('lets a cheaper model win on score alone: only moving up must clear minScoreGain', () => {
    // A real /route test: a rename after a sonnet turn stayed on sonnet, haiku better by 0.025.
    const s = { ...withContext(session({ currentModel: 'acme.big' }), 0), turns: 3 };
    const strict = settings({ routing: { mode: 'auto', sticky: { enabled: true, minScoreGain: 0.9 } } });
    const { decision } = decide(decideInput({ text: TYPO, session: s, settings: strict }));
    expect(decision.selection.model).toBe('acme.small');
    expect(decision.decisionSource).not.toBe('sticky');
  });

  it('never blocks an upgrade for high-risk work, however large the context', () => {
    const s = withContext(session({ currentModel: 'acme.small' }), 900_000);
    const { decision } = decide(decideInput({ text: SECURITY, session: s }));
    expect(decision.selection.model).toBe('acme.big');
    expect(decision.reason).toMatch(/sticky routing bypassed/);
  });

  it('upgrades high-risk work even when weights favour the cheap current model', () => {
    const s = withContext(session({ currentModel: 'acme.small' }), 0);
    const stingy = settings({
      routing: { mode: 'auto', weights: { quality: 1, cost: 10, latency: 5, transition: 10 } },
    });
    const { decision } = decide(decideInput({ text: SECURITY, session: s, settings: stingy }));
    expect(decision.selection.model).toBe('acme.big');
    expect(decision.decisionSource).not.toBe('sticky');
    expect(decision.reason).toMatch(/upgrade from acme\.small required \(tier 3\)/);
  });

  it('takes the strongest model when none reaches the needed tier', () => {
    const r = registry({
      models: [
        { id: 'acme.small', provider: 'acme', displayName: 'S', tier: 1, agentModelIds: { 'claude-code': 'small' } },
        { id: 'acme.mid', provider: 'acme', displayName: 'M', tier: 2, agentModelIds: { 'claude-code': 'mid' } },
      ],
      pricing: [],
    });
    const { decision } = decide(decideInput({ text: SECURITY, registry: r, session: session({ currentModel: 'acme.small' }) }));
    expect(decision.selection.model).toBe('acme.mid');
    expect(decision.reason).toMatch(/upgrade from acme\.small required \(tier 3; none available, strongest taken\)/);
    // Already on the strongest: kept, and not called an upgrade (a real /route explain said
    // "upgrade from opus required" while staying on opus).
    const kept = decide(decideInput({ text: SECURITY, registry: r, session: session({ currentModel: 'acme.mid' }) })).decision;
    expect(kept.selection.model).toBe('acme.mid');
    expect(kept.reason).toMatch(/needs tier 3; acme\.mid is the strongest available, kept/);
    expect(kept.reason).not.toMatch(/upgrade from/);
  });

  it('accepts the agent-native name of the current model', () => {
    const s = withContext(session({ currentModel: 'big' }), 400_000);
    const { decision } = decide(decideInput({ text: FEATURE, session: s }));
    expect(decision).toMatchObject({ decisionSource: 'sticky', selection: { model: 'acme.big' } });
  });

  it('does not label a switch-cost stay as sticky when sticky routing is off', () => {
    const s = withContext(session({ currentModel: 'acme.big' }), 400_000);
    const noSticky = settings({ routing: { mode: 'auto', sticky: { enabled: false, minScoreGain: 0.15 } } });
    const { decision } = decide(decideInput({ text: FEATURE, session: s, settings: noSticky }));
    expect(decision.decisionSource).toBe('classifier-rules');
  });

  it('respects a rule that forbids switching', () => {
    const rules = compileRules([{ id: 'stay', name: 's', when: { taskTypes: ['bug_fix'] }, then: { avoidModelSwitch: true } }]);
    const s = withContext(session({ currentModel: 'acme.big' }), 0);
    const { decision } = decide(decideInput({ text: TYPO, rules, session: s }));
    expect(decision).toMatchObject({ decisionSource: 'sticky', selection: { model: 'acme.big' } });
    expect(decision.reason).toMatch(/rule stay avoids model switches/);
  });

  it('ignores minScoreGain when sticky routing is off', () => {
    const s = withContext(session({ currentModel: 'acme.big' }), 0);
    const noSticky = settings({ routing: { mode: 'auto', sticky: { enabled: false, minScoreGain: 0.9 } } });
    const { decision } = decide(decideInput({ text: TYPO, session: s, settings: noSticky }));
    expect(decision.selection.model).toBe('acme.small');
  });
});

describe('decide: adapter capabilities (AC-8)', () => {
  it('marks a decision unsupported instead of applying when the agent cannot switch', () => {
    const agent = { id: 'claude-code', capabilities: { startupModelSelection: true } };
    const { decision, shouldApply, trace } = decide(decideInput({ agent }));
    expect(decision.status).toBe('unsupported');
    expect(shouldApply).toBe(false);
    expect(trace.join('\n')).toMatch(/cannot switch models during a session/);
  });
});

describe('decide: isolation (AC-5)', () => {
  it('two sessions with different state get independent decisions from shared inputs', () => {
    const shared = decideInput();
    const a = withOverride(createSessionState({ sessionId: 'a', agentId: 'claude-code' }), { model: 'big' });
    const b = createSessionState({ sessionId: 'b', agentId: 'claude-code', subagentId: 'sub-1' });
    const first = decide({ ...shared, session: a, text: TYPO });
    const second = decide({ ...shared, session: b, text: TYPO });
    expect(first.decision).toMatchObject({ sessionId: 'a', selection: { model: 'acme.big' } });
    expect(second.decision).toMatchObject({ sessionId: 'b', subagentId: 'sub-1', selection: { model: 'acme.small' } });
    expect(a.override.model).toBe('big');
  });
});

describe('decide: safe fallback', () => {
  it('keeps the current model when routing fails', () => {
    const broken = { ...registry(), candidatesFor: () => { throw new Error('registry exploded'); } };
    const { decision, shouldApply, trace } = decide(decideInput({ registry: broken, session: session({ currentModel: 'acme.mid' }) }));
    expect(decision).toMatchObject({ decisionSource: 'fallback', status: 'skipped', selection: { model: 'acme.mid' } });
    expect(shouldApply).toBe(false);
    expect(trace[0]).toBe('router error: registry exploded');
  });

  it('returns a null decision when not even the current model is known', () => {
    const { decision, shouldApply } = decide(decideInput({ registry: registry({ models: [], pricing: [] }) }));
    expect(decision).toBeNull();
    expect(shouldApply).toBe(false);
  });

  it('survives garbage input', () => {
    expect(decide(undefined)).toEqual({ decision: null, shouldApply: false, trace: [expect.stringMatching(/^router error/)] });
    expect(decide({}).decision).toBeNull();
  });

  it('fails over when no candidate has a tier', () => {
    const r = registry({
      models: [{ id: 'acme.untiered', provider: 'acme', displayName: 'U', agentModelIds: { 'claude-code': 'u' } }],
      pricing: [],
    });
    const { trace } = decide(decideInput({ registry: r }));
    expect(trace[0]).toMatch(/no candidate model has a tier/);
  });
});

describe('decide: agent without CLAUDE_CODE capabilities object', () => {
  it('uses the fixture agent by default', () => {
    expect(decideInput().agent).toBe(CLAUDE_CODE);
  });
});
