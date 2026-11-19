'use strict';

const { z } = require('zod');
const { EFFORT_LEVELS, MODEL_STATUSES } = require('../constants');

/** `<provider>.<model>`, lowercase, e.g. `anthropic.claude-sonnet`. */
const ModelIdSchema = z
  .string()
  .regex(/^[a-z0-9-]+\.[a-z0-9][a-z0-9.-]*$/, 'must look like <provider>.<model> in lowercase');

const ProviderSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  displayName: z.string().min(1),
  kind: z.enum(['cloud', 'local']),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

const ModelSchema = z.object({
  id: ModelIdSchema,
  provider: z.string().regex(/^[a-z0-9-]+$/),
  displayName: z.string().min(1),
  family: z.string().min(1).optional(),
  aliases: z.array(z.string().min(1)).default([]),
  capabilities: z
    .object({
      coding: z.boolean().default(false),
      reasoning: z.boolean().default(false),
      vision: z.boolean().default(false),
      toolUse: z.boolean().default(false),
    })
    .prefault({}),
  /**
   * Relative capability rank inside the registry (1 = fastest/cheapest, higher = stronger).
   * An ordinal taken from the provider's own positioning (Haiku < Sonnet < Opus < Fable),
   * not a benchmark score; null keeps the model out of automatic routing (manual/rules only).
   */
  tier: z.number().int().min(1).max(5).nullable().default(null),
  supportedEffort: z.array(z.enum(EFFORT_LEVELS)).default([]),
  /** The level the model uses when none is sent, when the provider documents one. */
  defaultEffort: z.enum(EFFORT_LEVELS).nullable().default(null),
  /** null until taken from an official source; never guessed. */
  contextWindow: z.number().int().positive().nullable().default(null),
  maxOutputTokens: z.number().int().positive().nullable().default(null),
  /** How each agent names this model, e.g. `{ "claude-code": "sonnet" }`. */
  agentModelIds: z.record(z.string(), z.string().min(1)).default({}),
  status: z.enum(MODEL_STATUSES).default('enabled'),
});

const pricePerMillion = z.number().nonnegative().nullable().default(null);

/**
 * A dated, sourced price record (ADR-008). Prices may be null, but the
 * source and date never are, so an unsourced price cannot pass as current.
 */
const PricingSchema = z.object({
  modelId: ModelIdSchema,
  currency: z.literal('USD').default('USD'),
  inputPerMillion: pricePerMillion,
  outputPerMillion: pricePerMillion,
  cacheReadPerMillion: pricePerMillion,
  cacheWritePerMillion: pricePerMillion,
  /** Higher rates that apply when a request's input exceeds `thresholdTokens`. */
  longContext: z
    .object({
      thresholdTokens: z.number().int().positive(),
      inputPerMillion: z.number().nonnegative(),
      outputPerMillion: z.number().nonnegative(),
      /** Long-context cache rates, when the provider lists them; else the base cache rates apply. */
      cacheReadPerMillion: z.number().nonnegative().optional(),
      cacheWritePerMillion: z.number().nonnegative().optional(),
    })
    .strict()
    .nullable()
    .default(null),
  sourceUrl: z.url({ protocol: /^https$/ }),
  asOf: z.iso.date(),
  notes: z.string().max(500).optional(),
});

module.exports = { ModelIdSchema, ProviderSchema, ModelSchema, PricingSchema };
