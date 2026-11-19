'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { CliError } = require('../errors');
const { stop } = require('./daemon');

const BACKUP_PATTERN = /^smr\.db\.bak-v\d+-/;
// writeBackup's `<file>.<hex>.tmp` and writeJsonAtomic's `.<name>.<hex>.tmp`.
const TEMP_PATTERN = /^smr\.db\.bak-v\d+-.*\.[0-9a-f]{8}\.tmp$/;
const CONFIG_TEMP_PATTERN = /^\.(config|rules)\.json\.[0-9a-f]{12}\.tmp$/;

/**
 * Everything this program wrote to the data folders: known names only, so a shared
 * folder (SMR_HOME pointing at a folder with other files) loses nothing else.
 */
function ownFiles(paths) {
  const files = [
    paths.configFile,
    paths.rulesFile,
    paths.tokenFile,
    paths.pidFile,
    paths.dbFile,
    `${paths.dbFile}-wal`,
    `${paths.dbFile}-shm`,
    paths.serverLogFile,
  ];
  const dbDir = path.dirname(paths.dbFile);
  if (fs.existsSync(dbDir)) for (const name of fs.readdirSync(dbDir)) if (BACKUP_PATTERN.test(name) || TEMP_PATTERN.test(name)) files.push(path.join(dbDir, name));
  // Temp files an interrupted atomic write of the config or rules left behind.
  const configDir = path.dirname(paths.configFile);
  if (fs.existsSync(configDir)) for (const name of fs.readdirSync(configDir)) if (CONFIG_TEMP_PATTERN.test(name)) files.push(path.join(configDir, name));
  if (fs.existsSync(paths.logDir)) for (const name of fs.readdirSync(paths.logDir)) if (/^server\.log(\.\d+)?$/.test(name)) files.push(path.join(paths.logDir, name));
  return [...new Set(files)].filter((file) => fs.existsSync(file));
}

/** Removes a folder only when it is empty: never anything we did not write. */
function removeIfEmpty(dir) {
  try {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
      return true;
    }
  } catch {
    // In use or not ours to remove.
  }
  return false;
}

/**
 * Stops the daemon and, with --purge --yes, deletes the config, token, rules, database
 * (and its pre-upgrade backups) and logs. The program itself is removed by npm, the
 * Claude Code mod by Claude Code: this says how, it does not do either.
 */
async function uninstall(ctx, options) {
  if (options.purge && !options.yes) {
    // A dry run changes nothing, the daemon included.
    const files = ownFiles(ctx.paths);
    ctx.print(`would delete ${files.length} file(s) (cannot be undone):`);
    for (const file of files) ctx.print(`  ${file}`);
    throw new CliError('add --yes to delete them');
  }
  try {
    await stop(ctx);
  } catch (error) {
    // A broken config.json must not block the cleanup that would fix it.
    ctx.print(`could not stop the daemon (${error.message}): if one is running, end it by hand`);
  }
  // Listed after stopping: the daemon removes its pid file and closes the database.
  const files = ownFiles(ctx.paths);
  if (options.purge) {
    for (const file of files) fs.rmSync(file, { force: true });
    const dirs = [ctx.paths.logDir, ctx.paths.dataDir, ctx.paths.configDir];
    const removed = dirs.filter((dir, i) => dirs.indexOf(dir) === i && removeIfEmpty(dir));
    ctx.print(`deleted ${files.length} file(s)${removed.length > 0 ? ` and ${removed.length} empty folder(s)` : ''}`);
  } else {
    ctx.print(`kept your data (${files.length} file(s)): mr uninstall --purge --yes deletes it`);
  }
  ctx.print('to finish:');
  ctx.print('  claude plugin uninstall smart-model-router@smart-model-router-local   (if you installed the Claude Code mod)');
  ctx.print('  npm uninstall -g smart-model-router');
}

function register(program, ctx) {
  program
    .command('uninstall')
    .description('stop the daemon; with --purge --yes also delete the config, token, database and logs')
    .option('--purge', 'delete your data too (lists it without --yes)')
    .option('--yes', 'confirm --purge')
    .action((options) => uninstall(ctx, options));
}

module.exports = { register, uninstall, ownFiles };
