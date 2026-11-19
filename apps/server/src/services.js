'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadSettings, saveSettings, loadRegistryData, writeJsonAtomic, DEFAULT_DATA_DIR } = require('@smr/config');
const { createRegistry, compileRules, costComparison, describeModels } = require('@smr/core');
const { detectAgents } = require('@smr/adapters');
const { RoutingRuleSchema, parseOrThrow, ValidationError } = require('@smr/shared');

const MAX_USER_RULES = 200;
const PERIODS = Object.freeze({ '24h': 24, '7d': 24 * 7, '30d': 24 * 30, '90d': 24 * 90, all: null });

/** A JSON array file, or null when it does not exist. Throws on unreadable or non-array content. */
function readJsonArray(file) {
  if (!fs.existsSync(file)) return null;
  const json = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (!Array.isArray(json)) throw new ValidationError(`${file} must hold a JSON array`);
  return json;
}

/**
 * What the dashboard API reads and changes, over the same files and database the CLI
 * uses. Every write validates first and is atomic.
 *
 * @param {{
 *   paths: ReturnType<typeof import('@smr/config').resolvePaths>,
 *   storage: ReturnType<typeof import('@smr/storage').openStorage>,
 *   dataDir?: string,
 *   detectors?: Record<string, Function>,
 *   now?: () => Date,
 * }} options
 */
function createServices({ paths, storage, dataDir = DEFAULT_DATA_DIR, detectors, now = () => new Date() }) {
  const registry = () => createRegistry(loadRegistryData(dataDir));
  const shippedFile = path.join(dataDir, 'routing-rules', 'default.json');

  function sinceOf(period) {
    const hours = PERIODS[period];
    if (hours === undefined) throw new ValidationError(`period must be one of ${Object.keys(PERIODS).join(', ')}`);
    return hours === null ? null : new Date(now().getTime() - hours * 3600 * 1000).toISOString();
  }

  /** Shipped rules plus the user's, each user rule replacing a shipped one with its id. */
  function rules() {
    const shipped = (readJsonArray(shippedFile) ?? []).map((rule) => ({ ...rule, source: 'shipped' }));
    let user = [];
    let userError = null;
    try {
      user = readJsonArray(paths.rulesFile) ?? [];
      compileRules(user);
    } catch (error) {
      userError = error.message;
    }
    const userIds = new Set(user.map((rule) => rule?.id));
    return {
      file: paths.rulesFile,
      userError,
      rules: [...shipped.filter((rule) => !userIds.has(rule.id)), ...user.map((rule) => ({ ...rule, source: 'user' }))],
      user,
    };
  }

  return Object.freeze({
    periods: Object.keys(PERIODS),

    overview(period = '7d') {
      const since = sinceOf(period);
      const stats = storage.records.stats({ since });
      const comparison = costComparison(registry(), storage.records.usage({ since }));
      return { period, since, stats, comparison, last: storage.records.summary().last };
    },

    history({ limit = 100, sessionId, status, period = 'all' } = {}) {
      return storage.records.history({ limit, sessionId, status, since: sinceOf(period) });
    },

    rules,

    /** Replaces the user's rules file; refuses the whole list on any invalid rule. */
    saveUserRules(list) {
      if (!Array.isArray(list)) throw new ValidationError('rules must be an array');
      if (list.length > MAX_USER_RULES) throw new ValidationError(`at most ${MAX_USER_RULES} rules`);
      const parsed = list.map((rule, index) => parseOrThrow(RoutingRuleSchema, rule, `rule #${index + 1}`));
      try {
        compileRules(parsed);
      } catch (error) {
        throw new ValidationError(error.message);
      }
      writeJsonAtomic(paths.rulesFile, parsed, 'rules file');
      return rules();
    },

    /**
     * What agent integrations route with: the rules (valid and enabled, highest priority
     * first) and the scoring tuning. Mode, privacy and the classifier are not here: each
     * agent keeps those in its own settings, where the person consented to them.
     */
    effectiveRouting() {
      const { rules: all, userError } = rules();
      if (userError) throw new ValidationError(`user rules are invalid: ${userError}`);
      const { sticky, weights } = loadSettings(paths.configFile).routing;
      return { rules: compileRules(all.map(({ source: _source, ...rule }) => rule)), tuning: { sticky, weights } };
    },

    models() {
      return describeModels(registry(), now().toISOString().slice(0, 10));
    },

    agents() {
      return storage.agents.list();
    },

    async detectAgents() {
      const found = await detectAgents({ registry: registry(), detectors, now });
      found.forEach((agent) => storage.agents.save(agent));
      return found;
    },

    settings() {
      return loadSettings(paths.configFile);
    },

    /** Saves validated settings; says when the daemon must restart to apply them. */
    saveSettings(next) {
      const before = loadSettings(paths.configFile);
      let saved;
      try {
        saved = saveSettings(paths.configFile, next);
      } catch (error) {
        // Refused values are the caller's mistake; a failed write is not.
        if (error.code === 'E_CONFIG' && Array.isArray(error.details?.issues)) throw new ValidationError(error.message, error.details.issues);
        throw error;
      }
      const restartNeeded = saved.server.port !== before.server.port || saved.server.host !== before.server.host;
      return { settings: saved, restartNeeded };
    },

    benchmarks(limit = 20) {
      return storage.benchmarks.recent(limit);
    },
  });
}

module.exports = { createServices, PERIODS, MAX_USER_RULES };
