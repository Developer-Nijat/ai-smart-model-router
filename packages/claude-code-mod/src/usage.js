'use strict';

const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

/**
 * Claude Code's per-step usage (snake_case, as the engine reports it) in the core's
 * token shape. Null when the step reported none.
 *
 * @param {{ input_tokens?: number, output_tokens?: number, cache_read_input_tokens?: number, cache_creation_input_tokens?: number } | null | undefined} usage
 */
function tokensOf(usage) {
  if (!usage || typeof usage !== 'object') return null;
  return Object.freeze({
    inputTokens: count(usage.input_tokens),
    outputTokens: count(usage.output_tokens),
    cacheReadTokens: count(usage.cache_read_input_tokens),
    cacheWriteTokens: count(usage.cache_creation_input_tokens),
  });
}

/** Sum of token records; null entries are skipped. */
function addTokens(list) {
  const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  return Object.freeze(
    list.filter(Boolean).reduce(
      (sum, t) => ({
        inputTokens: sum.inputTokens + t.inputTokens,
        outputTokens: sum.outputTokens + t.outputTokens,
        cacheReadTokens: sum.cacheReadTokens + t.cacheReadTokens,
        cacheWriteTokens: sum.cacheWriteTokens + t.cacheWriteTokens,
      }),
      zero,
    ),
  );
}

/**
 * The conversation size after a step: everything the step read (fresh, cached and newly
 * cached) plus what it wrote, which the next step reads back. Null when unknown.
 */
function contextTokensAfter(usage) {
  const tokens = tokensOf(usage);
  if (!tokens) return null;
  return tokens.inputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens + tokens.outputTokens;
}

module.exports = { tokensOf, addTokens, contextTokensAfter };
