'use strict';

const { AgentCapabilitiesSchema } = require('@smr/shared');
const { OPERATION_CAPABILITY } = require('@smr/adapters');

const STATUSES = ['ok', 'unsupported', 'failed'];

/**
 * The contract every agent adapter must pass. Call it from a `*.test.js` file
 * with a factory that builds a fresh adapter per test.
 *
 * @param {string} name label for the describe block
 * @param {() => import('@smr/adapters').BaseAgentAdapter} createAdapter
 */
function defineAdapterContract(name, createAdapter) {
  describe(`adapter contract: ${name}`, () => {
    let adapter;
    beforeEach(() => {
      adapter = createAdapter();
    });
    afterEach(async () => {
      await adapter.dispose();
    });

    it('has a stable id and display name', () => {
      expect(adapter.id).toMatch(/^[a-z0-9-]+$/);
      expect(adapter.displayName.length).toBeGreaterThan(0);
    });

    it('reports valid, frozen capabilities', () => {
      expect(AgentCapabilitiesSchema.safeParse(adapter.capabilities).success).toBe(true);
      expect(Object.isFrozen(adapter.capabilities)).toBe(true);
    });

    it('answers detection with a well-formed result', async () => {
      const info = await adapter.detectInstallation();
      expect(typeof info.installed).toBe('boolean');
      expect(info.version === null || typeof info.version === 'string').toBe(true);
      expect(Array.isArray(info.notes)).toBe(true);
    });

    it('answers every operation with a result object, never a bare value', async () => {
      const calls = [
        adapter.getCurrentModel(),
        adapter.getAvailableModels(),
        adapter.applyModel('anthropic.claude-sonnet', 'medium'),
        adapter.applyStartupModel('anthropic.claude-sonnet', 'medium'),
        adapter.getSessionContext(),
        adapter.getUsage(),
        adapter.registerCommands(),
      ];
      for (const result of await Promise.all(calls)) {
        expect(STATUSES).toContain(result.status);
        expect(result.ok).toBe(result.status === 'ok');
      }
    });

    // AC-8: an operation the adapter has no capability for is never reported as done.
    it.each(Object.keys(OPERATION_CAPABILITY))('never claims %s without the capability for it', async (operation) => {
      if (adapter.supports(operation)) return;
      const result = await adapter[operation]('anthropic.claude-sonnet', 'medium');
      expect(result.status).toBe('unsupported');
      expect(result.ok).toBe(false);
    });
  });
}

module.exports = { defineAdapterContract };
