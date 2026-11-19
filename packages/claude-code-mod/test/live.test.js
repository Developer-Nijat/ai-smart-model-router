'use strict';

const { liveMessage, taskPhrase, shortModel } = require('../src/live');

const TIERS = { 'anthropic.claude-haiku': 1, 'anthropic.claude-sonnet': 2, 'anthropic.claude-opus': 3 };
const tierOf = (id) => TIERS[id] ?? null;

function decision(overrides = {}) {
  return {
    mode: 'auto',
    classification: { taskType: 'bug_fix', complexity: 0.2, reasoning: 'low', risk: 'low' },
    selection: { model: 'anthropic.claude-haiku', effort: 'low' },
    decisionSource: 'classifier-rules',
    reason: 'bug_fix, complexity 0.2 → anthropic.claude-haiku',
    ...overrides,
  };
}

describe('live routing messages', () => {
  it('names a downgrade with the task and why it is fine', () => {
    const m = liveMessage({ decision: decision(), applies: true, previousModel: 'anthropic.claude-opus', tierOf });
    expect(m).toMatchObject({ tone: 'down', icon: '▼', title: 'opus → haiku/low', detail: 'light bug fix · a cheaper model is enough' });
    expect(m.line).toBe('▼ router · opus → haiku/low · light bug fix · a cheaper model is enough');
  });

  it('names an upgrade, and deep reasoning when the task needs it', () => {
    const d = decision({
      classification: { taskType: 'security', complexity: 0.7, reasoning: 'high', risk: 'high' },
      selection: { model: 'anthropic.claude-opus', effort: 'xhigh' },
    });
    const m = liveMessage({ decision: d, applies: true, previousModel: 'anthropic.claude-sonnet', tierOf });
    expect(m).toMatchObject({ tone: 'up', icon: '▲', title: 'sonnet → opus/xhigh', detail: 'heavy security work · high risk · needs deeper reasoning' });
  });

  it('says when it stays, and why', () => {
    const switchCost = liveMessage({
      decision: decision({ decisionSource: 'sticky', selection: { model: 'anthropic.claude-opus', effort: 'medium' }, reason: 'kept anthropic.claude-opus: switching to x would re-read the context without cache (switch cost)' }),
      applies: true,
      previousModel: 'anthropic.claude-opus',
      tierOf,
    });
    expect(switchCost).toMatchObject({ tone: 'stay', title: 'staying on opus/medium' });
    expect(switchCost.detail).toContain('switching would re-read the whole context');
    const small = liveMessage({ decision: decision({ decisionSource: 'sticky', reason: 'kept a: b better by only 0.1 (< 0.15)' }), applies: true, tierOf });
    expect(small.detail).toContain('only slightly better');
  });

  it('shows shadow mode as a recommendation, never a switch', () => {
    const m = liveMessage({ decision: decision({ mode: 'shadow' }), applies: false, previousModel: 'anthropic.claude-opus', tierOf });
    expect(m).toMatchObject({ tone: 'shadow', icon: '◇', title: 'would use haiku/low', detail: 'light bug fix · shadow mode, staying on opus' });
  });

  it('marks overrides, rules and subagents', () => {
    expect(liveMessage({ decision: decision({ decisionSource: 'manual' }), applies: true })).toMatchObject({ tone: 'manual', title: 'override → haiku/low' });
    expect(liveMessage({ decision: decision({ decisionSource: 'rule', reason: 'rule short-haiku; effort by rule short-haiku' }), applies: true })).toMatchObject({
      tone: 'rule',
      detail: 'your rule short-haiku',
    });
    expect(liveMessage({ decision: decision(), applies: true, subagentType: 'Explore' })).toMatchObject({ tone: 'subagent', title: 'subagent Explore → haiku/low' });
    expect(liveMessage({ decision: decision(), applies: false, subagentType: 'Explore' }).tone).toBe('shadow');
  });

  it('keeps the same model quietly', () => {
    const m = liveMessage({ decision: decision(), applies: true, previousModel: 'anthropic.claude-haiku', tierOf });
    expect(m).toMatchObject({ tone: 'same', icon: '●', title: 'haiku/low' });
  });

  it('reads labels only: no prompt text can reach the message', () => {
    expect(taskPhrase(null)).toBe('task');
    expect(taskPhrase({ taskType: 'unknown-type', complexity: 0.9, risk: 'low' })).toBe('heavy task');
    expect(shortModel('anthropic.claude-sonnet')).toBe('sonnet');
    expect(shortModel('acme.big')).toBe('big');
  });
});
