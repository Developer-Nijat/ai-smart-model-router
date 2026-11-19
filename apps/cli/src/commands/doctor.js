'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readToken, aclReport } = require('@smr/config');
const { compileRules } = require('@smr/core');
const { ClaudeCodeAdapter } = require('@smr/adapters');
const { probe } = require('./daemon');
const { CliError } = require('../errors');

const MIN_NODE = [22, 13, 0];
const MOD_FILE_LIMIT = 1024 * 1024;
const PRICE_STALE_DAYS = 90;

const ok = (name, detail) => ({ name, status: 'ok', detail });
const warn = (name, detail) => ({ name, status: 'warn', detail });
const fail = (name, detail) => ({ name, status: 'fail', detail });

/** The token exists, is well formed, and (on Windows) only its owner can read it. */
function tokenCheck(ctx) {
  const file = ctx.paths.tokenFile;
  if (!readToken(file)) return warn('token', 'none yet: run mr init');
  if ((ctx.platform ?? process.platform) !== 'win32') return ok('token', file);
  const { others } = (ctx.aclReport ?? aclReport)(file);
  if (others.length === 0) return ok('token', `${file} (owner only)`);
  return warn('token', `${file} is readable by ${others.join(', ')}: run mr init to narrow it to you`);
}

/** Runs a check; a check that throws is a failure with its message, never a crash. */
async function check(name, run) {
  try {
    return await run();
  } catch (error) {
    return fail(name, error.message);
  }
}

function nodeVersion(version) {
  const parts = version.replace(/^v/, '').split('.').map(Number);
  const newEnough = parts[0] > MIN_NODE[0] || (parts[0] === MIN_NODE[0] && parts[1] >= MIN_NODE[1]);
  return newEnough ? ok('node', version) : fail('node', `${version}; Smart Model Router needs ${MIN_NODE.join('.')} or newer (node:sqlite)`);
}

async function runChecks(ctx, versions = process.versions) {
  const checks = [nodeVersion(`v${versions.node}`)];
  checks.push(await check('settings', () => ok('settings', `${ctx.paths.configFile} (mode ${ctx.settings().routing.mode})`)));
  checks.push(await check('token', () => tokenCheck(ctx)));
  checks.push(
    await check('database', () => {
      if (!fs.existsSync(ctx.paths.dbFile)) return warn('database', 'none yet: run mr init');
      return ctx.withStorage((storage) => {
        const integrity = storage.integrityCheck();
        if (integrity !== 'ok') return fail('database', `integrity check: ${integrity}`);
        return ok('database', `${ctx.paths.dbFile} (schema ${storage.migration.to}, ${storage.records.summary().total} decisions)`);
      });
    }),
  );
  checks.push(
    await check('registry', () => {
      const registry = ctx.registry();
      const usable = registry.candidatesFor('claude-code').length;
      const day = ctx.now().toISOString().slice(0, 10);
      const dates = registry.models().map((m) => registry.pricingFor(m.id, day)?.asOf).filter(Boolean).sort();
      const newest = dates.at(-1);
      if (usable === 0) return fail('registry', 'no enabled model for Claude Code');
      if (!newest) return warn('registry', `${usable} model(s), no prices recorded`);
      const ageDays = Math.floor((ctx.now() - new Date(`${newest}T00:00:00Z`)) / 86_400_000);
      return ageDays > PRICE_STALE_DAYS
        ? warn('registry', `prices are ${ageDays} days old (as of ${newest}); check the source and update data/pricing`)
        : ok('registry', `${usable} model(s) for Claude Code, prices as of ${newest}`);
    }),
  );
  checks.push(await check('rules', () => ok('rules', `${compileRules(ctx.rules()).length} rule(s) valid`)));
  checks.push(
    await check('daemon', async () => {
      const port = ctx.settings().server.port;
      const running = await probe(ctx, port);
      if (running?.verified) return ok('daemon', `running, pid ${running.pid}, port ${port}`);
      if (running) return fail('daemon', `port ${port} is held by a program that did not prove it is this daemon`);
      return warn('daemon', `not running on port ${port}: mr start (decisions stay buffered in the mod meanwhile)`);
    }),
  );
  checks.push(
    await check('claude-code', async () => {
      const info = await new ClaudeCodeAdapter({ runner: ctx.detectors['claude-code'] }).detectInstallation();
      if (!info.installed) return warn('claude-code', 'not found on PATH');
      const old = info.notes.find((note) => note.includes('older than'));
      return old ? warn('claude-code', old) : ok('claude-code', `version ${info.version}`);
    }),
  );
  checks.push(
    await check('mod', () => {
      if (!fs.existsSync(ctx.modBundle)) return warn('mod', 'not built: npm run build:mod');
      const size = fs.statSync(ctx.modBundle).size;
      return size < MOD_FILE_LIMIT ? ok('mod', `${ctx.modBundle} (${Math.round(size / 1024)} KB)`) : fail('mod', `bundle is ${size} bytes, over the 1 MiB mod file limit`);
    }),
  );
  checks.push(
    await check('dashboard', () =>
      fs.existsSync(path.join(ctx.dashboardDir, 'index.html')) ? ok('dashboard', ctx.dashboardDir) : warn('dashboard', 'not built: npm run build:dashboard, then restart the daemon'),
    ),
  );
  return checks;
}

async function doctor(ctx, options) {
  const checks = await runChecks(ctx);
  const failed = checks.filter((c) => c.status === 'fail').length;
  if (options.json) ctx.printJson({ ok: failed === 0, checks });
  else {
    const mark = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' };
    for (const c of checks) ctx.print(`${mark[c.status]}  ${c.name.padEnd(12)} ${c.detail}`);
  }
  if (failed > 0) throw new CliError(`${failed} check(s) failed`, 1);
}

function register(program, ctx) {
  program
    .command('doctor')
    .description('check the installation: node, settings, database, daemon, Claude Code, mod')
    .option('--json', 'machine-readable output')
    .action((options) => doctor(ctx, options));
}

module.exports = { register, doctor, runChecks, nodeVersion };
