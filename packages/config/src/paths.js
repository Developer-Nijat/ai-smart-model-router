'use strict';

const path = require('node:path');
const os = require('node:os');

const APP_DIR = 'smart-model-router';

/**
 * Where user data lives, outside the install folder so upgrades never touch it.
 *
 * Config (small, worth roaming) and data (a live WAL SQLite database, logs) are kept
 * apart: on Windows the database goes to LOCALAPPDATA, never the roaming profile,
 * which may sync it mid-write; on Linux the XDG config/data/state homes are used.
 * `SMR_HOME` puts everything in one folder.
 *
 * Pure: everything it reads comes in through `context`, which makes every OS testable.
 *
 * @param {{ platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv, homedir?: string }} [context]
 * @returns {Readonly<{ configDir: string, dataDir: string, logDir: string, configFile: string, dbFile: string, rulesFile: string, tokenFile: string, pidFile: string, serverLogFile: string }>}
 */
function resolvePaths(context = {}) {
  const platform = context.platform ?? process.platform;
  const env = context.env ?? process.env;
  const home = context.homedir ?? os.homedir();
  const p = platform === 'win32' ? path.win32 : path.posix;

  const dirs = env.SMR_HOME ? singleRoot(p.resolve(env.SMR_HOME), p) : platformDirs(platform, env, home, p);

  return Object.freeze({
    ...dirs,
    configFile: p.join(dirs.configDir, 'config.json'),
    dbFile: p.join(dirs.dataDir, 'smr.db'),
    /** The person's own routing rules (shipped ones live in data/routing-rules). */
    rulesFile: p.join(dirs.configDir, 'rules.json'),
    /** The local API token: integrations send it, nothing else knows it. */
    tokenFile: p.join(dirs.configDir, 'token'),
    pidFile: p.join(dirs.dataDir, 'server.pid'),
    serverLogFile: p.join(dirs.logDir, 'server.log'),
  });
}

function singleRoot(root, p) {
  return { configDir: root, dataDir: root, logDir: p.join(root, 'logs') };
}

/** An XDG variable counts only when it is an absolute path (XDG Base Directory spec). */
function xdg(env, name, fallback, p) {
  const value = env[name];
  return value && p.isAbsolute(value) ? value : fallback;
}

function platformDirs(platform, env, home, p) {
  if (platform === 'win32') {
    const roaming = env.APPDATA || p.join(home, 'AppData', 'Roaming');
    const local = env.LOCALAPPDATA || p.join(home, 'AppData', 'Local');
    const dataDir = p.join(local, APP_DIR);
    return { configDir: p.join(roaming, APP_DIR), dataDir, logDir: p.join(dataDir, 'logs') };
  }
  if (platform === 'darwin') {
    const root = p.join(home, 'Library', 'Application Support', APP_DIR);
    return { configDir: root, dataDir: root, logDir: p.join(home, 'Library', 'Logs', APP_DIR) };
  }
  return {
    configDir: p.join(xdg(env, 'XDG_CONFIG_HOME', p.join(home, '.config'), p), APP_DIR),
    dataDir: p.join(xdg(env, 'XDG_DATA_HOME', p.join(home, '.local', 'share'), p), APP_DIR),
    logDir: p.join(xdg(env, 'XDG_STATE_HOME', p.join(home, '.local', 'state'), p), APP_DIR, 'logs'),
  };
}

module.exports = { resolvePaths, APP_DIR };
