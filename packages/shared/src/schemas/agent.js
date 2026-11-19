'use strict';

const { z } = require('zod');

/**
 * What an agent integration can really do. Every flag defaults to false:
 * a capability is claimed only after it is verified, never assumed.
 */
const AgentCapabilitiesSchema = z
  .object({
    /** The model can be chosen when a session starts (e.g. a `--model` flag), not during it. */
    startupModelSelection: z.boolean().default(false),
    /** The model can be changed for the next prompt inside a running session. */
    promptLevelRouting: z.boolean().default(false),
    /** The model can be changed per turn (and kept for every step of that turn). */
    turnLevelRouting: z.boolean().default(false),
    subagentRouting: z.boolean().default(false),
    effortControl: z.boolean().default(false),
    usageTracking: z.boolean().default(false),
    slashCommands: z.boolean().default(false),
    /** The agent reports its current model and the models it can use. */
    modelDiscovery: z.boolean().default(false),
    /** The agent exposes session context (size, cache state). */
    sessionContext: z.boolean().default(false),
  })
  .strict();

const AgentInfoSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  displayName: z.string().min(1),
  installed: z.boolean(),
  version: z.string().min(1).nullable().default(null),
  capabilities: AgentCapabilitiesSchema.prefault({}),
  /** Known limitations, shown verbatim by `mr agents` and `mr doctor`. */
  notes: z.array(z.string()).default([]),
});

module.exports = { AgentCapabilitiesSchema, AgentInfoSchema };
