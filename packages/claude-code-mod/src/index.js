'use strict';

/**
 * Entry point of the code the Claude Code mod runs. `scripts/build.js` bundles it, with
 * the registry data and routing rules, into one ES module (ADR-003): the mod itself has
 * no Node APIs, so nothing here may touch the file system or the network.
 */

const { withOverride, afterClear } = require('@smr/core');
const { createRouter, AGENT_ID, CAPABILITIES } = require('./router');
const { settingsFromOptions, withMode, withTuning } = require('./settings');
const command = require('./command');
const usage = require('./usage');
const daemon = require('./daemon');
const { liveMessage, LIVE_CHOICES } = require('./live');

module.exports = {
  createRouter,
  AGENT_ID,
  CAPABILITIES,
  settingsFromOptions,
  withMode,
  withTuning,
  ...command,
  ...usage,
  ...daemon,
  withOverride,
  afterClear,
  liveMessage,
  LIVE_CHOICES,
};
