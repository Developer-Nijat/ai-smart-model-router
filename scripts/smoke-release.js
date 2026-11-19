#!/usr/bin/env node
'use strict';

/**
 * Installs the release tarball into a throw-away npm prefix and drives the installed
 * `mr` as a person would: init, start, record, history, dashboard sign-in, doctor,
 * benchmark, stop, uninstall --purge. Nothing touches the real data folder or a real
 * Claude Code: SMR_HOME and the npm prefix are temporary, the daemon uses port 3106.
 *
 *   node scripts/smoke-release.js [path/to/smart-model-router-x.y.z.tgz]
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 3106;
const WIN = process.platform === 'win32';
/** cmd.exe joins arguments unquoted: quote each so a path with spaces stays one argument. */
const forShell = (arg) => (WIN && !/^[\w.:\\/=-]+$/.test(arg) ? `"${String(arg).replace(/"/g, '""')}"` : arg);

function findTarball() {
  const given = process.argv[2];
  if (given) return path.resolve(given);
  const dir = path.join(ROOT, 'release');
  const found = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.tgz')) : [];
  if (found.length !== 1) throw new Error('give the tarball path, or run npm run release first');
  return path.join(dir, found[0]);
}

function step(name) {
  process.stdout.write(`- ${name}\n`);
}

async function main() {
  const tarball = findTarball();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-smoke-'));
  const prefix = path.join(tmp, 'prefix');
  const home = path.join(tmp, 'home');
  const env = { ...process.env, SMR_HOME: home };
  const npmCmd = WIN ? 'npm.cmd' : 'npm';
  const mrBin = WIN ? path.join(prefix, 'mr.cmd') : path.join(prefix, 'bin', 'mr');
  const mr = (...args) => execFileSync(forShell(mrBin), args.map(forShell), { env, encoding: 'utf8', shell: WIN, timeout: 60_000 }).trim();
  let started = false;

  try {
    step(`install ${path.basename(tarball)} into a temporary prefix`);
    execFileSync(npmCmd, ['install', '-g', '--prefix', prefix, '--no-audit', '--no-fund', tarball].map(forShell), { stdio: 'ignore', shell: WIN });
    const installed = WIN ? path.join(prefix, 'node_modules', 'smart-model-router') : path.join(prefix, 'lib', 'node_modules', 'smart-model-router');
    assert.ok(!fs.existsSync(path.join(installed, 'node_modules')), 'the release must need no dependencies');

    step('mr --version, init');
    assert.match(mr('--version'), /^\d+\.\d+\.\d+$/);
    const init = JSON.parse(mr('init', '--json', '--show-token'));
    const token = init.modSettings.pluginConfigs['smart-model-router@inline'].options.daemonToken;
    assert.match(token, /^[0-9a-f]{64}$/);
    mr('config', 'set', 'server.port', String(PORT));

    step('start the daemon from the installed package');
    assert.match(mr('start'), new RegExp(`started: pid \\d+, http://127\\.0\\.0\\.1:${PORT}`));
    started = true;
    const status = JSON.parse(mr('status', '--json'));
    assert.equal(status.daemon.running, true);
    assert.equal(status.install.kind, 'release');

    step('record a decision and read it back');
    const record = {
      decision: {
        id: 'smoke:t1',
        sessionId: 'smoke',
        turnId: 't1',
        agentId: 'claude-code',
        mode: 'auto',
        selection: { model: 'anthropic.claude-haiku', effort: 'low' },
        reason: 'smoke test',
        decisionSource: 'classifier-rules',
        status: 'applied',
        appliedModel: 'claude-haiku-5-5',
        createdAt: new Date().toISOString(),
      },
      verified: true,
      answeredBy: ['claude-haiku-5-5'],
      steps: 1,
      tokens: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
    const origin = `http://127.0.0.1:${PORT}`;
    const posted = await fetch(`${origin}/v1/records`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ records: [record] }),
    });
    assert.deepEqual(await posted.json(), { accepted: 1, duplicates: 0, rejected: [] });
    assert.deepEqual(JSON.parse(mr('history', '--json')).map((e) => e.id), ['smoke:t1']);

    step('dashboard: page served, sign-in, history through the API');
    const page = await fetch(`${origin}/`);
    assert.match(await page.text(), /<div id="root">/);
    const code = /#code=([0-9a-f]{64})/.exec(mr('dashboard', '--no-open'))[1];
    const { session } = await (await fetch(`${origin}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ code }) })).json();
    const viaApi = await (await fetch(`${origin}/api/history`, { headers: { 'x-smr-session': session } })).json();
    assert.deepEqual(viaApi.map((e) => e.id), ['smoke:t1']);
    const routing = await (await fetch(`${origin}/v1/routing`, { headers: { authorization: `Bearer ${token}` } })).json();
    assert.ok(Array.isArray(routing.rules));

    step('doctor, models, benchmark');
    const doctor = JSON.parse(mr('doctor', '--json'));
    const by = Object.fromEntries(doctor.checks.map((c) => [c.name, c.status]));
    for (const name of ['database', 'registry', 'daemon', 'mod', 'dashboard']) assert.equal(by[name], 'ok', `doctor ${name}: ${JSON.stringify(doctor.checks.find((c) => c.name === name))}`);
    assert.ok(JSON.parse(mr('models', '--json')).length > 0);
    assert.ok(JSON.parse(mr('benchmark', '--json')).results.find((r) => r.strategy === 'router').match > 0);

    step('stop, then uninstall --purge');
    assert.match(mr('stop'), /stopped: pid \d+/);
    started = false;
    await assert.rejects(fetch(`${origin}/health`));
    mr('uninstall', '--purge', '--yes');
    assert.ok(!fs.existsSync(path.join(home, 'config.json')), 'purge removes the config');
    process.stdout.write('release smoke test passed\n');
  } finally {
    if (started) {
      try {
        mr('stop');
      } catch {
        // Already gone.
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`release smoke test FAILED: ${error.message}\n`);
  process.exitCode = 1;
});
