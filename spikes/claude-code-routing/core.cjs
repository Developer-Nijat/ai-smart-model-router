'use strict';

// Spike-only stand-in for packages/core: pure, no I/O, CommonJS.
// Its only job is to prove a CJS module bundled to ESM loads inside a Claude Code mod.

const RULES = Object.freeze([
  { id: 'high-risk', pattern: /\b(security|vulnerab|architect|migration|race condition)\w*/i, model: 'opus', effort: 'high' },
  { id: 'trivial', pattern: /\b(typo|rename|comment|format|lint|css)\w*/i, model: 'haiku', effort: 'low' },
]);

const MANUAL_MODELS = Object.freeze(['haiku', 'sonnet', 'opus']);

function decide(text, options) {
  const override = options && options.override;
  if (override && MANUAL_MODELS.includes(override)) {
    return { model: override, effort: undefined, source: 'manual', reason: `manual override: ${override}` };
  }
  const input = typeof text === 'string' ? text : '';
  const rule = RULES.find((r) => r.pattern.test(input));
  if (rule) {
    return { model: rule.model, effort: rule.effort, source: 'rule', reason: `rule ${rule.id}` };
  }
  return { model: 'sonnet', effort: 'medium', source: 'default', reason: 'no rule matched' };
}

module.exports = { decide, MANUAL_MODELS };
