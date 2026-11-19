'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { resolvePaths, loadSettings, loadRegistryData, loadRules, DEFAULT_DATA_DIR, layout } = require('@smr/config');
const { openStorage } = require('@smr/storage');
const { createRegistry } = require('@smr/core');

const LAYOUT = layout();
const REPO_ROOT = LAYOUT.root;
const SERVER_BIN = LAYOUT.serverBin;
const MOD_BUNDLE = path.join(LAYOUT.modDir, 'lib', 'router.mjs');
const DASHBOARD_DIR = LAYOUT.dashboardDir;

/**
 * Opens a URL in the default browser without a shell: the URL is one argument, never
 * parsed as a command line. Resolves once the opener started.
 */
function openInBrowser(url, { platform = process.platform, spawner = spawn } = {}) {
  const [command, args] =
    platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  return new Promise((resolve, reject) => {
    const child = spawner(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * Everything a command touches outside its own logic, in one place, so tests can swap
 * any of it: where files live, output, the clock, HTTP, process spawning.
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   out?: (text: string) => void,
 *   err?: (text: string) => void,
 *   now?: () => Date,
 *   fetch?: typeof fetch,
 *   spawn?: typeof spawn,
 *   kill?: (pid: number) => void,
 *   sleep?: (ms: number) => Promise<void>,
 *   openUrl?: (url: string) => Promise<void>,
 *   detectors?: object,
 *   dataDir?: string,
 * }} [options]
 */
function createContext(options = {}) {
  const env = options.env ?? process.env;
  const paths = resolvePaths({ env });
  const out = options.out ?? ((text) => process.stdout.write(text));
  const err = options.err ?? ((text) => process.stderr.write(text));
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;

  return Object.freeze({
    env,
    paths,
    dataDir,
    serverBin: options.serverBin ?? SERVER_BIN,
    layout: LAYOUT,
    modBundle: options.modBundle ?? MOD_BUNDLE,
    dashboardDir: options.dashboardDir ?? DASHBOARD_DIR,
    now: options.now ?? (() => new Date()),
    fetch: options.fetch ?? globalThis.fetch,
    spawn: options.spawn ?? spawn,
    kill: options.kill ?? ((pid) => process.kill(pid)),
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    openUrl: options.openUrl ?? ((url) => openInBrowser(url)),
    platform: options.platform ?? process.platform,
    aclReport: options.aclReport,
    detectors: options.detectors ?? {},
    print: (text = '') => out(`${text}\n`),
    printJson: (value) => out(`${JSON.stringify(value, null, 2)}\n`),
    warn: (text) => err(`${text}\n`),
    settings: () => loadSettings(paths.configFile),
    registry: () => createRegistry(loadRegistryData(dataDir)),
    rules: () => loadRules({ dataDir, userRulesFile: paths.rulesFile }),
    /** Opens the database, runs `work`, always closes it. */
    withStorage(work) {
      const storage = openStorage(paths.dbFile);
      try {
        return work(storage);
      } finally {
        storage.close();
      }
    },
  });
}

module.exports = { createContext, openInBrowser, REPO_ROOT, SERVER_BIN, MOD_BUNDLE };
