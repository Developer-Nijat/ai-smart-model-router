'use strict';

const { BaseAgentAdapter } = require('./base-adapter');
const { detectCli } = require('./detect');
const { ok, failed } = require('./result');

/** The oldest Claude Code version the mod was verified against (Mods API, turn.step). */
const MIN_CLAUDE_CODE_VERSION = '2.1.327';

/**
 * Verified in docs/spike-claude-code.md and docs/claude-code-integration.md: per-turn model
 * and effort through `turn.step`, subagent models through `agent.spawn`, usage per step,
 * `/route` through `$.command.register`. Startup selection is not needed: turn routing
 * covers the first turn too.
 */
const CLAUDE_CODE_CAPABILITIES = Object.freeze({
  startupModelSelection: false,
  promptLevelRouting: false,
  turnLevelRouting: true,
  subagentRouting: true,
  effortControl: true,
  usageTracking: true,
  slashCommands: true,
  modelDiscovery: true,
  sessionContext: true,
});

const NO_SESSION = 'runs inside a Claude Code session through the smart-model-router mod; no live session is attached to this process';

/**
 * Claude Code as seen from outside the session (CLI, daemon). The routing itself happens
 * in the mod (ADR-002, ADR-003): this adapter detects the installation and lists the
 * models; operations on a live session answer `failed` with the reason, never a guess.
 */
class ClaudeCodeAdapter extends BaseAgentAdapter {
  #registry;
  #runner;

  /**
   * @param {{ registry?: { candidatesFor(agentId: string): object[] }, runner?: Function }} [options]
   */
  constructor(options = {}) {
    super({ id: 'claude-code', displayName: 'Claude Code', capabilities: CLAUDE_CODE_CAPABILITIES });
    this.#registry = options.registry ?? null;
    this.#runner = options.runner;
  }

  async detectInstallation() {
    const found = await detectCli({ command: 'claude', minVersion: MIN_CLAUDE_CODE_VERSION, runner: this.#runner });
    const notes = [...found.notes];
    if (found.supported) notes.push('model routing runs in the smart-model-router mod (claude --plugin-dir <mod folder>)');
    return { installed: found.installed, version: found.version, notes };
  }

  async getAvailableModels() {
    if (!this.#registry) return failed('getAvailableModels', 'no model registry given');
    return ok(this.#registry.candidatesFor(this.id).map((model) => ({ id: model.id, agentModelId: model.agentModelIds[this.id] })));
  }

  async getCurrentModel() {
    return failed('getCurrentModel', NO_SESSION);
  }

  async applyModel() {
    return failed('applyModel', NO_SESSION);
  }

  async getSessionContext() {
    return failed('getSessionContext', NO_SESSION);
  }

  async getUsage() {
    return failed('getUsage', NO_SESSION);
  }

  async registerCommands() {
    return failed('registerCommands', 'the mod registers /route when its session starts');
  }
}

module.exports = { ClaudeCodeAdapter, CLAUDE_CODE_CAPABILITIES, MIN_CLAUDE_CODE_VERSION };
