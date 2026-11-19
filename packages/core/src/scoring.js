'use strict';

const { clamp, round } = require('./util');

/**
 * The capability tier a task needs, on the registry's tier scale (1..5, fractional).
 * A heuristic starting point, to be calibrated against benchmark results (Phase 4),
 * not a measured fact.
 */
function requiredTier(classification) {
  const { complexity, reasoning, risk } = classification;
  return clamp(1 + complexity * 2.2 + (reasoning === 'high' ? 0.4 : 0) + (risk === 'high' ? 0.4 : 0), 1, 5);
}

/**
 * How well a model of `tier` fits a task needing `needed` (0..1).
 * Slightly over-powered costs little here (cost is weighed separately); slightly
 * under-powered is tolerated; clearly under-powered falls off fast.
 */
function qualityFit(tier, needed) {
  const deficit = needed - tier;
  if (deficit <= 0) return 1 - 0.05 * -deficit;
  if (deficit <= 0.5) return 1 - 0.3 * deficit;
  return Math.max(0, 0.85 - 0.7 * (deficit - 0.5));
}

/** Assumed switch cost when the context size is unknown: cautious, not free. */
const UNKNOWN_CONTEXT_SWITCH_COST = 0.3;

/**
 * The smallest share of the switch cost a model pays however cheap it is: a cold cache
 * is slower, and a model change mid-task is not free even when the re-read is.
 */
const SWITCH_PRICE_FLOOR = 0.25;

/**
 * Cost of leaving the current model: the prompt cache is per model, so a switch re-reads
 * the whole context, at the candidate's price. 0 with no current model, when staying, or
 * with an empty context (after /clear); otherwise the context load (0..1, or a cautious
 * constant when unknown) times the candidate's relative price (0..1, 1 = the dearest),
 * never below SWITCH_PRICE_FLOOR of it. Re-reading on a cheap model costs little, so the
 * router no longer stays on an expensive one just to keep its cache.
 */
function transitionCost(currentId, candidateId, contextLoad, relativePrice = 1) {
  if (!currentId || currentId === candidateId) return 0;
  const load = contextLoad ?? UNKNOWN_CONTEXT_SWITCH_COST;
  return load * Math.max(SWITCH_PRICE_FLOOR, Math.min(1, relativePrice));
}

/**
 * Score = Q·Wq − C·Wc − L·Wl − T·Wt for every candidate with a tier, best first.
 *
 * @param {{
 *   candidates: readonly object[],
 *   classification: object,
 *   weights: { quality: number, cost: number, latency: number, transition: number },
 *   costs: Readonly<Record<string, number>>,
 *   currentId: string | null,
 *   contextLoad: number | null,
 *   exemptFromTransitionAtTier?: number | null,
 * }} input
 * @returns {Array<{ model: object, score: number, parts: { quality: number, cost: number, latency: number, transition: number } }>}
 */
function scoreCandidates(input) {
  const { candidates, classification, weights, costs, currentId, contextLoad } = input;
  const ranked = candidates.filter((model) => model.tier !== null);
  if (ranked.length === 0) return [];
  const needed = requiredTier(classification);
  const maxTier = Math.max(...ranked.map((model) => model.tier));
  const latencyWeight = weights.latency * (classification.latencyPriority ? 2 : 1);
  const exemptTier = input.exemptFromTransitionAtTier ?? null;

  return ranked
    .map((model) => {
      const exempt = exemptTier !== null && model.tier >= exemptTier;
      const cost = costs[model.id] ?? 1;
      const parts = {
        quality: qualityFit(model.tier, needed),
        cost,
        latency: model.tier / maxTier,
        transition: exempt ? 0 : transitionCost(currentId, model.id, contextLoad, cost),
      };
      const score =
        parts.quality * weights.quality -
        parts.cost * weights.cost -
        parts.latency * latencyWeight -
        parts.transition * weights.transition;
      return {
        model,
        score: round(score),
        parts: Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, round(value)])),
      };
    })
    .sort((a, b) => b.score - a.score || a.model.tier - b.model.tier);
}

module.exports = { requiredTier, qualityFit, transitionCost, scoreCandidates, UNKNOWN_CONTEXT_SWITCH_COST, SWITCH_PRICE_FLOOR };
