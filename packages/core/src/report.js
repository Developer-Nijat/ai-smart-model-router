'use strict';

const { estimateCostUsd } = require('./cost');

const DEFAULT_AGENT = 'claude-code';

/** Registry id of a model name an agent reported (`claude-haiku-5-5[1m]`), or null. */
function modelIdOf(registry, name, agent = DEFAULT_AGENT) {
  return registry.fromAgentModelName(agent, String(name).replace(/\[[^\]]*\]$/, ''))?.id ?? null;
}

const round = (n) => Math.round(n * 1e6) / 1e6;

/**
 * What the reported usage cost, and what the same tokens would have cost on each model
 * the agent can run, at the list price of each turn's day.
 *
 * Every figure covers the same turns: those priced both as answered and on every
 * candidate model (`comparedTurns`). Turns with any unknown price are left out of all
 * figures (`excludedTurns`), never counted as zero — otherwise a model unpriced on some
 * days would look cheaper only because it covers fewer turns. Figures are null when no
 * turn can be compared. Same tokens on another model is an approximation — another
 * model would not produce exactly the same tokens.
 *
 * @param {ReturnType<typeof import('./registry').createRegistry>} registry
 * @param {{ model: string, recordedAt: string, tokens: object }[]} usage
 */
function costComparison(registry, usage, agent = DEFAULT_AGENT) {
  const price = (modelId, row) => (modelId ? estimateCostUsd(row.tokens, registry.pricingFor(modelId, row.recordedAt.slice(0, 10))) : null);
  const candidates = registry.candidatesFor(agent).map((model) => model.id);
  const priced = usage
    .map((row) => ({ actual: price(modelIdOf(registry, row.model, agent), row), on: candidates.map((id) => price(id, row)) }))
    .filter((p) => p.actual !== null && p.on.every((v) => v !== null));
  const total = (pick) => (priced.length === 0 ? null : round(priced.reduce((sum, p) => sum + pick(p), 0)));
  return {
    turnsWithUsage: usage.length,
    comparedTurns: priced.length,
    excludedTurns: usage.length - priced.length,
    actualUsd: total((p) => p.actual),
    sameTokensOnlyOn: Object.fromEntries(candidates.map((id, i) => [id, total((p) => p.on[i])])),
  };
}

/**
 * The registry as rows for people: each model with its Claude Code name, status and the
 * sourced price in force on `day` (null when none is known).
 *
 * @param {ReturnType<typeof import('./registry').createRegistry>} registry
 * @param {string} day YYYY-MM-DD
 */
function describeModels(registry, day) {
  return registry.models().map((model) => {
    const price = registry.pricingFor(model.id, day);
    return {
      id: model.id,
      name: model.displayName,
      claudeCode: model.agentModelIds[DEFAULT_AGENT] ?? null,
      tier: model.tier,
      status: registry.isUsable(model) ? 'enabled' : 'disabled',
      efforts: model.supportedEffort,
      contextWindow: model.contextWindow,
      price: price
        ? {
            inputPerMillion: price.inputPerMillion,
            outputPerMillion: price.outputPerMillion,
            cacheReadPerMillion: price.cacheReadPerMillion,
            cacheWritePerMillion: price.cacheWritePerMillion,
            asOf: price.asOf,
            sourceUrl: price.sourceUrl,
          }
        : null,
    };
  });
}

module.exports = { modelIdOf, costComparison, describeModels };
