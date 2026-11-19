'use strict';

const fs = require('node:fs');
const { defaultSettings, loadSettings, saveSettings, ensureToken } = require('@smr/config');
const { openStorage } = require('@smr/storage');
const { CliError } = require('../errors');

/** The Claude Code settings that point the mod at this daemon. */
function modSettings(settings, token, { showToken = false } = {}) {
  return {
    pluginConfigs: {
      'smart-model-router@inline': {
        options: {
          defaultMode: settings.routing.mode,
          privacyMode: settings.privacy.mode,
          daemonUrl: `http://127.0.0.1:${settings.server.port}`,
          daemonToken: showToken ? token : '<run mr init --show-token, or paste the token file>',
        },
      },
    },
  };
}

function init(ctx, options) {
  const { paths } = ctx;
  const created = [];
  let settings;
  if (fs.existsSync(paths.configFile)) {
    settings = loadSettings(paths.configFile);
  } else {
    settings = saveSettings(paths.configFile, defaultSettings());
    created.push(paths.configFile);
  }
  const { token, created: newToken } = ensureToken(paths.tokenFile);
  if (newToken) created.push(paths.tokenFile);
  const storage = openStorage(paths.dbFile);
  const migration = storage.migration;
  storage.close();

  const report = { created, paths, schema: migration.to, modSettings: modSettings(settings, token, { showToken: Boolean(options.showToken) }) };
  if (options.json) return ctx.printJson(report);
  ctx.print(created.length > 0 ? `created:\n${created.map((f) => `  ${f}`).join('\n')}` : 'already initialized');
  ctx.print(`database: ${paths.dbFile} (schema ${migration.to}${migration.applied.length > 0 ? `, applied ${migration.applied.join(', ')}` : ''})`);
  ctx.print('');
  ctx.print('Claude Code mod settings:');
  ctx.print(JSON.stringify(report.modSettings, null, 2));
  ctx.print(`The token is in ${paths.tokenFile}. Prefer the plugin's own settings (/plugin → configure): Claude Code keeps`);
  ctx.print('daemonToken in secure storage there. A token on a command line can be seen by other local users.');
  ctx.print('');
  ctx.print('next: mr start, then claude --plugin-dir dist/claude-code-mod --settings <the JSON above>');
  return undefined;
}

/** Reads `a.b.c` from an object. */
function getPath(object, key) {
  return key.split('.').reduce((value, part) => (value && Object.hasOwn(value, part) ? value[part] : undefined), object);
}

/** A copy of `object` with `a.b.c` set; the original is untouched. */
function setPath(object, key, value) {
  const [head, ...rest] = key.split('.');
  if (rest.length === 0) return { ...object, [head]: value };
  const child = object?.[head];
  return { ...object, [head]: setPath(child && typeof child === 'object' ? child : {}, rest.join('.'), value) };
}

/** `true`, `3`, `"x"` and `null` as JSON; anything else as a string. */
function parseValue(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const KEY_PATTERN = /^[a-zA-Z]+(?:\.[a-zA-Z]+)*$/;

function config(ctx, action, key, value, options) {
  const settings = ctx.settings();
  if (!action || action === 'list') return options.json ? ctx.printJson(settings) : ctx.print(JSON.stringify(settings, null, 2));
  if (action === 'path') return ctx.print(ctx.paths.configFile);
  if (!key || !KEY_PATTERN.test(key)) throw new CliError('give a setting key like routing.mode');
  if (action === 'get') {
    const found = getPath(settings, key);
    if (found === undefined) throw new CliError(`no setting ${key}`);
    return ctx.print(typeof found === 'string' ? found : JSON.stringify(found, null, 2));
  }
  if (action === 'set') {
    if (value === undefined) throw new CliError('mr config set <key> <value>');
    if (getPath(settings, key) === undefined) throw new CliError(`no setting ${key}`);
    // saveSettings validates the whole file: an invalid value is refused, nothing written.
    const saved = saveSettings(ctx.paths.configFile, setPath(settings, key, parseValue(value)));
    return ctx.print(`${key} = ${JSON.stringify(getPath(saved, key))}`);
  }
  throw new CliError(`unknown action ${String(action).slice(0, 20)}: use list, get, set or path`);
}

function register(program, ctx) {
  program
    .command('init')
    .description('create the config, API token and database; print the Claude Code mod settings')
    .option('--show-token', 'print the real token in the settings (it is private)')
    .option('--json', 'machine-readable output')
    .action((options) => init(ctx, options));
  program
    .command('config')
    .description('show or change settings: list | get <key> | set <key> <value> | path')
    .argument('[action]')
    .argument('[key]')
    .argument('[value]')
    .option('--json', 'machine-readable output')
    .action((action, key, value, options) => config(ctx, action, key, value, options));
}

module.exports = { register, init, config, modSettings, getPath, setPath, parseValue };
