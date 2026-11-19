'use strict';

const { z } = require('zod');
const {
  ROUTING_MODES,
  PRIVACY_MODES,
  CLASSIFIER_PROVIDERS,
  LOG_LEVELS,
  LOOPBACK_HOSTS,
} = require('../constants');

const weight = z.number().min(0).max(10);

const SettingsSchema = z
  .object({
    version: z.literal(1).default(1),
    routing: z
      .object({
        mode: z.enum(ROUTING_MODES).default('shadow'),
        sticky: z
          .object({
            enabled: z.boolean().default(true),
            /** Minimum score gain (0..1) before leaving the current model. */
            minScoreGain: z.number().min(0).max(1).default(0.15),
          })
          .strict()
          .prefault({}),
        weights: z
          .object({
            quality: weight.default(1),
            cost: weight.default(0.3),
            latency: weight.default(0.1),
            transition: weight.default(0.5),
          })
          .strict()
          .prefault({}),
      })
      .strict()
      .prefault({}),
    privacy: z
      .object({
        mode: z.enum(PRIVACY_MODES).default('local-only'),
        /** Full prompts are never stored unless the person opts in. */
        storePrompts: z.boolean().default(false),
      })
      .strict()
      .prefault({}),
    classifier: z
      .object({
        enabled: z.boolean().default(false),
        provider: z.enum(CLASSIFIER_PROVIDERS).default('agent-session'),
        model: z.string().min(1).nullable().default(null),
        confidenceThreshold: z.number().min(0).max(1).default(0.7),
        timeoutMs: z.number().int().min(100).max(60000).default(3000),
      })
      .strict()
      .prefault({}),
    server: z
      .object({
        host: z.enum(LOOPBACK_HOSTS).default('127.0.0.1'),
        port: z.number().int().min(1024).max(65535).default(4747),
      })
      .strict()
      .prefault({}),
    logging: z
      .object({
        level: z.enum(LOG_LEVELS).default('info'),
      })
      .strict()
      .prefault({}),
  })
  .strict();

module.exports = { SettingsSchema };
