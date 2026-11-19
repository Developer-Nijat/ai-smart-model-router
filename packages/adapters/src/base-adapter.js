'use strict';

const { AgentCapabilitiesSchema, parseOrThrow } = require('@smr/shared');
const { unsupported } = require('./result');

/**
 * Which capability an operation needs. An adapter whose capabilities do not
 * include it must answer `unsupported` (checked by the contract tests).
 */
const OPERATION_CAPABILITY = Object.freeze({
  /** Switch the model inside a running session. Startup-only selection does not count. */
  applyModel: Object.freeze(['turnLevelRouting', 'promptLevelRouting']),
  /** Choose the model for the next session start. */
  applyStartupModel: Object.freeze(['startupModelSelection']),
  getCurrentModel: Object.freeze(['modelDiscovery']),
  getAvailableModels: Object.freeze(['modelDiscovery']),
  getSessionContext: Object.freeze(['sessionContext']),
  getUsage: Object.freeze(['usageTracking']),
  registerCommands: Object.freeze(['slashCommands']),
});

/**
 * The adapter contract (DISCUSSION §4.1). Every operation is optional: the base
 * answers `unsupported`, and a concrete adapter overrides only what it has
 * verified against a real installation. Adapters hold no routing state: that is
 * per session, owned by the caller.
 */
class BaseAgentAdapter {
  #id;
  #displayName;
  #capabilities;

  /**
   * @param {{ id: string, displayName: string, capabilities?: object }} definition
   */
  constructor(definition) {
    if (!definition || typeof definition.id !== 'string' || !/^[a-z0-9-]+$/.test(definition.id)) {
      throw new TypeError('Adapter id must be lowercase letters, digits and hyphens');
    }
    if (typeof definition.displayName !== 'string' || definition.displayName.length === 0) {
      throw new TypeError('Adapter displayName is required');
    }
    this.#id = definition.id;
    this.#displayName = definition.displayName;
    this.#capabilities = Object.freeze(
      parseOrThrow(AgentCapabilitiesSchema, definition.capabilities ?? {}, `capabilities of ${definition.id}`),
    );
  }

  get id() {
    return this.#id;
  }

  get displayName() {
    return this.#displayName;
  }

  /** A frozen copy: callers cannot change what an adapter claims. */
  get capabilities() {
    return this.#capabilities;
  }

  /** True when any capability that `operation` needs is present. */
  supports(operation) {
    const needed = OPERATION_CAPABILITY[operation];
    return Array.isArray(needed) && needed.some((name) => this.#capabilities[name] === true);
  }

  /** @returns {Promise<{ installed: boolean, version: string | null, notes: string[] }>} */
  async detectInstallation() {
    return { installed: false, version: null, notes: ['detection not implemented for this adapter'] };
  }

  async getCurrentModel() {
    return unsupported('getCurrentModel', `${this.#id} does not report its current model`);
  }

  async getAvailableModels() {
    return unsupported('getAvailableModels', `${this.#id} does not list its models`);
  }

  async applyModel(_model, _effort) {
    return unsupported('applyModel', `${this.#id} cannot switch models during a session`);
  }

  async applyStartupModel(_model, _effort) {
    return unsupported('applyStartupModel', `${this.#id} cannot choose a model at session start`);
  }

  async getSessionContext() {
    return unsupported('getSessionContext', `${this.#id} does not expose session context`);
  }

  async getUsage() {
    return unsupported('getUsage', `${this.#id} does not report usage`);
  }

  async registerCommands() {
    return unsupported('registerCommands', `${this.#id} has no command integration`);
  }

  async dispose() {}
}

module.exports = { BaseAgentAdapter, OPERATION_CAPABILITY };
