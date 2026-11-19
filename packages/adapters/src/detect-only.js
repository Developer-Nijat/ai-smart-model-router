'use strict';

const { BaseAgentAdapter } = require('./base-adapter');
const { detectCli } = require('./detect');

/**
 * An agent that is detected only (MVP): no capability is claimed until it is verified
 * against a real installation, so every operation answers `unsupported`.
 */
class DetectOnlyAdapter extends BaseAgentAdapter {
  #command;
  #runner;

  /** @param {{ id: string, displayName: string, command: string, runner?: Function }} definition */
  constructor({ id, displayName, command, runner }) {
    super({ id, displayName });
    this.#command = command;
    this.#runner = runner;
  }

  async detectInstallation() {
    const found = await detectCli({ command: this.#command, runner: this.#runner });
    const notes = [...found.notes];
    if (found.installed) notes.push(`${this.displayName}: detection only; model routing is not supported yet`);
    return { installed: found.installed, version: found.version, notes };
  }
}

class CodexAdapter extends DetectOnlyAdapter {
  constructor(options = {}) {
    super({ id: 'codex', displayName: 'OpenAI Codex CLI', command: 'codex', runner: options.runner });
  }
}

class GeminiCliAdapter extends DetectOnlyAdapter {
  constructor(options = {}) {
    super({ id: 'gemini-cli', displayName: 'Gemini CLI', command: 'gemini', runner: options.runner });
  }
}

module.exports = { DetectOnlyAdapter, CodexAdapter, GeminiCliAdapter };
