'use strict';

const { z } = require('zod');
const {
  EFFORT_LEVELS,
  TASK_TYPES,
  LEVELS,
  SCOPES,
  ROUTING_MODES,
  DECISION_SOURCES,
  DECISION_STATUSES,
} = require('../constants');
const { ModelIdSchema } = require('./model');

const unit = z.number().min(0).max(1);

/**
 * An identifier: session, turn, agent and decision ids are generated, never prose.
 * The pattern keeps free text (and so prompt text) out of every id column (AC-14).
 */
const IdSchema = z.string().regex(/^[A-Za-z0-9_.:@/-]{1,200}$/, 'must be an identifier (letters, digits, _ . : @ / -; at most 200)');

/** A description of the task, not a model choice. */
const ClassificationSchema = z.object({
  taskType: z.enum(TASK_TYPES),
  complexity: unit,
  reasoning: z.enum(LEVELS),
  codingDepth: z.enum(LEVELS),
  risk: z.enum(LEVELS),
  scope: z.enum(SCOPES),
  confidence: unit,
  latencyPriority: z.boolean().default(false),
  contextTokens: z.number().int().nonnegative().nullable().default(null),
});

const RuleConditionSchema = z
  .object({
    taskTypes: z.array(z.enum(TASK_TYPES)).min(1).optional(),
    // Bounded: every turn checks every keyword of every rule.
    keywords: z.array(z.string().min(1).max(100)).min(1).max(50).optional(),
    minComplexity: unit.optional(),
    maxComplexity: unit.optional(),
    risk: z.array(z.enum(LEVELS)).min(1).optional(),
    agents: z.array(z.string().min(1).max(100)).min(1).max(20).optional(),
    contextUtilizationAbove: unit.optional(),
  })
  .strict()
  .refine((when) => Object.keys(when).length > 0, { message: 'a rule needs at least one condition' })
  .refine(
    (when) =>
      when.minComplexity === undefined ||
      when.maxComplexity === undefined ||
      when.minComplexity <= when.maxComplexity,
    { message: 'minComplexity must not exceed maxComplexity' },
  );

const RuleActionSchema = z
  .object({
    model: ModelIdSchema.optional(),
    effort: z.enum(EFFORT_LEVELS).optional(),
    avoidModelSwitch: z.boolean().optional(),
  })
  .strict()
  .refine((then) => Object.keys(then).length > 0, { message: 'a rule needs at least one action' });

const RoutingRuleSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  /** Higher runs first; ties are broken by id for determinism. */
  priority: z.number().int().default(0),
  when: RuleConditionSchema,
  then: RuleActionSchema,
});

const AlternativeSchema = z.object({
  model: ModelIdSchema,
  score: z.number(),
  reason: z.string().max(500),
});

/**
 * One auditable routing decision. Holds no prompt text by design (AC-14):
 * `reason` is a short generated explanation, never the user's words.
 */
const RoutingDecisionSchema = z.object({
  id: IdSchema,
  sessionId: IdSchema,
  turnId: IdSchema.nullable().default(null),
  agentId: IdSchema,
  subagentId: IdSchema.nullable().default(null),
  mode: z.enum(ROUTING_MODES),
  classification: ClassificationSchema.nullable().default(null),
  selection: z.object({
    model: ModelIdSchema,
    effort: z.enum(EFFORT_LEVELS).nullable().default(null),
  }),
  alternatives: z.array(AlternativeSchema).max(20).default([]),
  reason: z.string().min(1).max(500),
  decisionSource: z.enum(DECISION_SOURCES),
  status: z.enum(DECISION_STATUSES),
  /** What the agent actually ran with, when it reports it (it may differ: silent effort downgrade). */
  appliedModel: z.string().regex(/^[A-Za-z0-9_.:@/[\]-]{1,200}$/).nullable().default(null),
  appliedEffort: z.enum(EFFORT_LEVELS).nullable().default(null),
  estimatedCostUsd: z.number().nonnegative().nullable().default(null),
  createdAt: z.iso.datetime(),
});

module.exports = {
  IdSchema,
  ClassificationSchema,
  RoutingRuleSchema,
  RoutingDecisionSchema,
  AlternativeSchema,
};
