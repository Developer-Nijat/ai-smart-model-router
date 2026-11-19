'use strict';

const { BaseAgentAdapter, ok } = require('@smr/adapters');

/**
 * A test double that verifiably supports turn-level routing and usage, and
 * nothing else. It proves the contract accepts an adapter that overrides
 * supported operations and inherits `unsupported` for the rest.
 */
class FakeAdapter extends BaseAgentAdapter {
  #appliedModel = null;

  constructor() {
    super({
      id: 'fake-agent',
      displayName: 'Fake Agent',
      capabilities: { turnLevelRouting: true, usageTracking: true, modelDiscovery: true },
    });
  }

  async detectInstallation() {
    return { installed: true, version: '1.0.0', notes: [] };
  }

  async applyModel(model, effort) {
    this.#appliedModel = model;
    return ok({ model, effort });
  }

  async getCurrentModel() {
    return ok(this.#appliedModel);
  }

  async getUsage() {
    return ok({ inputTokens: 0, outputTokens: 0 });
  }
}

module.exports = { FakeAdapter };
