'use strict';

const { round } = require('./util');

const PER_MILLION = 1_000_000;

/** Assumed token mix of a coding turn for comparing prices: 3 input tokens per output token. */
const BLEND_INPUT = 0.75;
const BLEND_OUTPUT = 0.25;

function part(tokens, rate) {
  if (!tokens) return 0;
  if (rate === null || rate === undefined) return null;
  return (tokens * rate) / PER_MILLION;
}

/**
 * Estimated API-equivalent cost in USD of real usage at a dated price (ADR-008).
 * null when a needed rate is unknown: an unknown is never priced as zero.
 * For subscription users this is a comparison figure, not what they pay.
 *
 * @param {{ inputTokens?: number, outputTokens?: number, cacheReadTokens?: number, cacheWriteTokens?: number }} usage
 * @param {object | null} pricing a PricingSchema record
 * @returns {number | null}
 */
function estimateCostUsd(usage, pricing) {
  if (!pricing) return null;
  const counts = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'].map((key) => usage?.[key] ?? 0);
  if (!counts.every((n) => Number.isFinite(n) && n >= 0)) return null;
  const [input, output, cacheRead, cacheWrite] = counts;
  // The prompt size that selects the tier counts cache reads and writes too (stated on the
  // provider's pricing page, checked 2026-11-19).
  const promptTokens = input + cacheRead + cacheWrite;
  const long = pricing.longContext && promptTokens > pricing.longContext.thresholdTokens ? pricing.longContext : null;
  const parts = [
    part(input, long ? long.inputPerMillion : pricing.inputPerMillion),
    part(output, long ? long.outputPerMillion : pricing.outputPerMillion),
    part(cacheRead, long?.cacheReadPerMillion ?? pricing.cacheReadPerMillion),
    part(cacheWrite, long?.cacheWritePerMillion ?? pricing.cacheWritePerMillion),
  ];
  if (parts.includes(null)) return null;
  return round(parts.reduce((sum, value) => sum + value, 0), 6);
}

/**
 * A per-model relative cost in 0..1 for scoring (1 = the dearest candidate).
 * Uses blended list prices when every candidate has one; otherwise falls back, for all
 * candidates alike, to the tier as a proxy, and says so in `basis`.
 *
 * @param {readonly object[]} models candidates
 * @param {(modelId: string) => object | null} pricingFor
 * @returns {{ basis: 'price' | 'tier-proxy', byModel: Readonly<Record<string, number>> }}
 */
function relativeCosts(models, pricingFor) {
  const blended = models.map((model) => {
    const price = pricingFor(model.id);
    if (!price || price.inputPerMillion === null || price.outputPerMillion === null) return null;
    return price.inputPerMillion * BLEND_INPUT + price.outputPerMillion * BLEND_OUTPUT;
  });
  const usePrice = blended.every((value) => value !== null);
  const raw = usePrice ? blended : models.map((model) => model.tier ?? 1);
  const max = Math.max(...raw, Number.EPSILON);
  return Object.freeze({
    basis: usePrice ? 'price' : 'tier-proxy',
    byModel: Object.freeze(Object.fromEntries(models.map((model, i) => [model.id, raw[i] / max]))),
  });
}

module.exports = { estimateCostUsd, relativeCosts };
