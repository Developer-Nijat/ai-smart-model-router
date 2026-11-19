'use strict';

const { RoutingRuleSchema, parseOrThrow } = require('@smr/shared');
const { deepFreeze } = require('./util');
const { normalise } = require('./classify-rules');

const byPriority = (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.id < b.id ? -1 : 1);

/**
 * Validates and orders rules: enabled only, highest priority first, ties by id
 * so the outcome never depends on file order.
 * @param {unknown[]} rules
 */
function compileRules(rules = []) {
  const parsed = rules.map((rule, index) => parseOrThrow(RoutingRuleSchema, rule, `routing rule #${index + 1}`));
  const ids = new Set();
  for (const rule of parsed) {
    if (ids.has(rule.id)) throw new TypeError(`Duplicate routing rule id: ${rule.id}`);
    ids.add(rule.id);
  }
  return deepFreeze(parsed.filter((rule) => rule.enabled).sort(byPriority));
}

/**
 * @param {object} when a rule's conditions
 * @param {{ classification: object, text: string, agentId: string, contextUtilization: number | null }} ctx
 */
function matches(when, ctx) {
  const { classification: c } = ctx;
  if (when.taskTypes && !when.taskTypes.includes(c.taskType)) return false;
  if (when.minComplexity !== undefined && c.complexity < when.minComplexity) return false;
  if (when.maxComplexity !== undefined && c.complexity > when.maxComplexity) return false;
  if (when.risk && !when.risk.includes(c.risk)) return false;
  if (when.agents && !when.agents.includes(ctx.agentId)) return false;
  if (when.contextUtilizationAbove !== undefined) {
    if (ctx.contextUtilization === null || !(ctx.contextUtilization > when.contextUtilizationAbove)) return false;
  }
  if (when.keywords) {
    const text = normalise(ctx.text);
    if (!when.keywords.some((keyword) => text.includes(normalise(keyword)))) return false;
  }
  return true;
}

/**
 * Applies compiled rules. Every condition of a rule must hold. For each action
 * (model, effort, avoidModelSwitch) the highest-priority matching rule that sets it wins;
 * lower rules cannot override it. Unknown context (utilization null) never matches.
 *
 * @param {readonly object[]} compiled from compileRules
 * @param {{ classification: object, text?: string, agentId: string, contextUtilization?: number | null }} ctx
 */
function evaluateRules(compiled, ctx) {
  const context = { text: '', contextUtilization: null, ...ctx };
  // Defensive: a caller that skipped compileRules still gets enabled-only, priority order.
  const ordered = compiled.filter((rule) => rule.enabled !== false).sort(byPriority);
  const matched = ordered.filter((rule) => matches(rule.when, context));
  const first = (field) => matched.find((rule) => rule.then[field] !== undefined) ?? null;
  const modelRule = first('model');
  const effortRule = first('effort');
  const avoidRule = first('avoidModelSwitch');

  return Object.freeze({
    matched: matched.map((rule) => rule.id),
    model: modelRule ? { value: modelRule.then.model, ruleId: modelRule.id } : null,
    effort: effortRule ? { value: effortRule.then.effort, ruleId: effortRule.id } : null,
    avoidModelSwitch: avoidRule ? { value: avoidRule.then.avoidModelSwitch, ruleId: avoidRule.id } : null,
  });
}

module.exports = { compileRules, evaluateRules };
