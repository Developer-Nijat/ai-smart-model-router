'use strict';

const { z } = require('zod');
const { RoutingDecisionSchema } = require('./routing');

const count = z.number().int().nonnegative();

/** Token counts as the agent reported them; never estimated. */
const TokensSchema = z
  .object({
    inputTokens: count,
    outputTokens: count,
    cacheReadTokens: count,
    cacheWriteTokens: count,
  })
  .strict();

/**
 * One finished turn as an agent integration reports it (the Claude Code mod's
 * TurnRecord). Strict: an unknown field is refused, so no prompt text can ride along.
 */
const TurnRecordSchema = z
  .object({
    decision: RoutingDecisionSchema,
    verified: z.boolean(),
    /** Model names as the agent reported them (`claude-opus-5-5[1m]`): no free text. */
    answeredBy: z.array(z.string().regex(/^[A-Za-z0-9_.:@/[\]-]{1,200}$/)).max(10),
    steps: count.max(10_000),
    tokens: TokensSchema,
    costComplete: z.boolean().optional(),
    trace: z.array(z.string().max(500)).max(20).default([]),
  })
  .strict();

const MAX_RECORDS_PER_BATCH = 500;

module.exports = { TokensSchema, TurnRecordSchema, MAX_RECORDS_PER_BATCH };
