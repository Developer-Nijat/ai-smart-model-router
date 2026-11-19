'use strict';

/**
 * Smart Model Router — routing core.
 *
 * ADR-001: everything here is a pure function of its arguments: no I/O, no timers,
 * no clock, no randomness and no global mutable state. Ids and timestamps come from
 * the caller. That lets the same code run inside the Claude Code mod (bundled to ESM,
 * ADR-003), in the CLI and in the local server, and keeps concurrent sessions isolated.
 * `test/purity.test.js` enforces it.
 */

const CORE_API_VERSION = 1;

const { createRegistry } = require('./registry');
const { classifyByRules, TASK_SIGNALS } = require('./classify-rules');
const hybrid = require('./hybrid');
const { compileRules, evaluateRules } = require('./rules');
const { desiredEffort, clampEffort } = require('./effort');
const { estimateCostUsd, relativeCosts } = require('./cost');
const scoring = require('./scoring');
const session = require('./session');
const { decide } = require('./decide');
const { modelIdOf, costComparison, describeModels } = require('./report');

module.exports = {
  CORE_API_VERSION,
  createRegistry,
  classifyByRules,
  TASK_SIGNALS,
  ...hybrid,
  compileRules,
  evaluateRules,
  desiredEffort,
  clampEffort,
  estimateCostUsd,
  relativeCosts,
  ...scoring,
  ...session,
  decide,
  modelIdOf,
  costComparison,
  describeModels,
};
