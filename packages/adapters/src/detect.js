'use strict';

const os = require('node:os');
const { execFile } = require('node:child_process');

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

/**
 * Runs `<command> --version` and resolves to its output; never rejects.
 *
 * Only fixed command names reach the shell. On Windows the CLIs are often `.cmd` shims,
 * which `execFile` cannot start without one; nothing a user typed is passed. It runs in
 * the home folder, never the current one: cmd.exe looks there first, so a `claude.cmd`
 * planted in an untrusted repository would otherwise run.
 *
 * @param {string} command a fixed executable name, e.g. `claude`
 * @param {{ timeoutMs?: number, run?: typeof execFile, platform?: string, cwd?: string }} [options]
 * @returns {Promise<{ found: boolean, output: string, error: string | null }>}
 */
function runVersion(command, options = {}) {
  if (!/^[a-z][a-z0-9-]*$/.test(command)) {
    return Promise.resolve({ found: false, output: '', error: 'invalid command name' });
  }
  const run = options.run ?? execFile;
  const platform = options.platform ?? process.platform;
  return new Promise((resolve) => {
    try {
      const windows = platform === 'win32';
      // With a shell the line is one string (no separate args: DEP0190).
      run(
        windows ? `${command} --version` : command,
        windows ? [] : ['--version'],
        {
          cwd: options.cwd ?? os.homedir(),
          timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
          shell: windows,
        },
        (error, stdout) => {
          if (error) {
            resolve({ found: false, output: '', error: describeError(error) });
            return;
          }
          resolve({ found: true, output: String(stdout ?? '').trim(), error: null });
        },
      );
    } catch {
      resolve({ found: false, output: '', error: 'failed to start' });
    }
  });
}

function describeError(error) {
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'output too large';
  if (error.code === 'ETIMEDOUT' || error.killed) return 'timed out';
  return 'not found or failed to run';
}

/** First `x.y.z` in the text, or null. */
function parseVersion(text) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? ''));
  return match ? match.slice(1, 4).join('.') : null;
}

/** -1, 0 or 1, comparing two `x.y.z` versions numerically. */
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Detects a CLI by its version output.
 *
 * @param {{ command: string, minVersion?: string | null, runner?: (command: string) => Promise<{ found: boolean, output: string, error: string | null }> }} input
 * @returns {Promise<{ installed: boolean, version: string | null, supported: boolean, notes: string[] }>}
 */
async function detectCli({ command, minVersion = null, runner = runVersion }) {
  const result = await runner(command);
  if (!result.found) return { installed: false, version: null, supported: false, notes: [`${command}: ${result.error ?? 'not found'}`] };
  const version = parseVersion(result.output);
  if (!version) return { installed: true, version: null, supported: false, notes: [`${command}: version not recognised`] };
  if (minVersion && compareVersions(version, minVersion) < 0) {
    return { installed: true, version, supported: false, notes: [`${command} ${version} is older than ${minVersion}, the oldest version verified`] };
  }
  return { installed: true, version, supported: true, notes: [] };
}

module.exports = { runVersion, parseVersion, compareVersions, detectCli };
