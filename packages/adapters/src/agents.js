'use strict';

const { ClaudeCodeAdapter } = require('./claude-code');
const { CodexAdapter, GeminiCliAdapter } = require('./detect-only');

/**
 * Detects every agent this build knows about. `detectors` replaces the `--version`
 * runner per agent id (tests); `now` stamps the result.
 *
 * @param {{ registry: object, detectors?: Record<string, Function>, now?: () => Date }} options
 */
async function detectAgents({ registry, detectors = {}, now = () => new Date() }) {
  const adapters = [
    new ClaudeCodeAdapter({ registry, runner: detectors['claude-code'] }),
    new CodexAdapter({ runner: detectors.codex }),
    new GeminiCliAdapter({ runner: detectors['gemini-cli'] }),
  ];
  const detectedAt = now().toISOString();
  return Promise.all(
    adapters.map(async (adapter) => {
      const info = await adapter.detectInstallation();
      return {
        id: adapter.id,
        displayName: adapter.displayName,
        installed: info.installed,
        version: info.version,
        capabilities: adapter.capabilities,
        notes: info.notes,
        detectedAt,
      };
    }),
  );
}

module.exports = { detectAgents };
