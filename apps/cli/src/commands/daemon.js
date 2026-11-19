'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const { readToken, ensureToken, healthProof } = require('@smr/config');
const { CliError } = require('../errors');

const START_WAIT_MS = 8000;
const STOP_WAIT_MS = 5000;
const POLL_MS = 100;
const PROBE_TIMEOUT_MS = 1000;

/**
 * Asks whatever listens on `port` who it is.
 * - null: nothing answers, or it is not a Smart Model Router daemon;
 * - `verified: true`: it proved it holds our token (HMAC over a fresh nonce), so it is
 *   our daemon and its pid can be trusted;
 * - `verified: false`: it claims to be one but cannot prove it (another program, or a
 *   daemon of another SMR_HOME). Never send it the token, never act on its pid.
 */
async function probe(ctx, port) {
  const nonce = crypto.randomBytes(16).toString('hex');
  let body;
  try {
    const res = await ctx.fetch(`http://127.0.0.1:${port}/health?nonce=${nonce}`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!res.ok) return null;
    body = await res.json();
  } catch {
    return null;
  }
  if (body?.service !== 'smart-model-router') return null;
  let token = null;
  try {
    token = readToken(ctx.paths.tokenFile);
  } catch {
    // An unreadable token cannot verify anything.
  }
  const expected = token ? healthProof(token, nonce) : null;
  const verified = Boolean(expected) && typeof body.proof === 'string' && body.proof.length === expected.length && crypto.timingSafeEqual(Buffer.from(body.proof), Buffer.from(expected));
  return { pid: body.pid, version: body.version, verified };
}

async function waitFor(ctx, condition, totalMs) {
  for (let waited = 0; waited <= totalMs; waited += POLL_MS) {
    const value = await condition();
    if (value) return value;
    await ctx.sleep(POLL_MS);
  }
  return null;
}

function readPid(file) {
  try {
    const pid = Number(fs.readFileSync(file, 'utf8').trim());
    return Number.isSafeInteger(pid) && pid > 1 ? pid : null;
  } catch {
    return null;
  }
}

function notOurs(port) {
  return new CliError(`port ${port} is held by a program that did not prove it is this daemon; change server.port (mr config set server.port <n>) or stop that program`);
}

async function start(ctx) {
  const port = ctx.settings().server.port;
  ensureToken(ctx.paths.tokenFile);
  const running = await probe(ctx, port);
  if (running?.verified) {
    ctx.print(`already running: pid ${running.pid}, http://127.0.0.1:${port}`);
    return;
  }
  if (running) throw notOurs(port);

  let spawnError = null;
  const child = ctx.spawn(process.execPath, [ctx.serverBin, '--log-file'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: ctx.env,
  });
  child.on?.('error', (error) => {
    spawnError = error;
  });
  child.unref();
  const up = await waitFor(ctx, async () => (spawnError ? { failed: true } : probe(ctx, port)), START_WAIT_MS);
  if (spawnError) throw new CliError(`could not start the daemon: ${spawnError.message}`);
  if (!up?.verified) throw new CliError(`the daemon did not start on port ${port}; see ${ctx.paths.serverLogFile}`);
  ctx.print(`started: pid ${up.pid}, http://127.0.0.1:${port}`);
  ctx.print(`log: ${ctx.paths.serverLogFile}`);
}

async function stop(ctx) {
  const port = ctx.settings().server.port;
  const running = await probe(ctx, port);
  if (!running) {
    fs.rmSync(ctx.paths.pidFile, { force: true });
    ctx.print('not running');
    return;
  }
  if (!running.verified) throw notOurs(port);
  const token = readToken(ctx.paths.tokenFile);
  try {
    await ctx.fetch(`http://127.0.0.1:${port}/v1/shutdown`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    // Falls through to the kill below.
  }
  let gone = await waitFor(ctx, async () => !(await probe(ctx, port)), STOP_WAIT_MS);
  // Kill only the pid the verified daemon reported AND its own pid file names.
  const pid = running.pid;
  if (!gone && Number.isSafeInteger(pid) && pid > 1 && readPid(ctx.paths.pidFile) === pid) {
    try {
      ctx.kill(pid);
    } catch {
      // Already exited.
    }
    gone = await waitFor(ctx, async () => !(await probe(ctx, port)), STOP_WAIT_MS);
  }
  if (!gone) throw new CliError(`the daemon (pid ${pid}) did not stop`);
  fs.rmSync(ctx.paths.pidFile, { force: true });
  ctx.print(`stopped: pid ${pid}`);
}

/** Runs a status part; a broken file is reported, never thrown (status is for diagnosis). */
function attempt(work) {
  try {
    return { value: work(), error: null };
  } catch (error) {
    return { value: null, error: error.message };
  }
}

async function status(ctx, options) {
  const settings = ctx.settings();
  const port = settings.server.port;
  const running = await probe(ctx, port);
  const db = fs.existsSync(ctx.paths.dbFile) ? attempt(() => ctx.withStorage((storage) => storage.records.summary())) : { value: null, error: null };
  const token = attempt(() => readToken(ctx.paths.tokenFile));
  const daemon = running?.verified
    ? { running: true, pid: running.pid, version: running.version, url: `http://127.0.0.1:${port}` }
    : { running: false, portHeldByOther: Boolean(running), stalePid: readPid(ctx.paths.pidFile) };
  const report = {
    daemon,
    routingMode: settings.routing.mode,
    privacyMode: settings.privacy.mode,
    decisions: db.value,
    problems: [db.error, token.error].filter(Boolean),
    paths: ctx.paths,
    install: { kind: ctx.layout.kind, root: ctx.layout.root },
    initialized: Boolean(token.value),
  };
  if (options.json) return ctx.printJson(report);
  if (daemon.running) ctx.print(`daemon: running (pid ${daemon.pid}, http://127.0.0.1:${port})`);
  else ctx.print(daemon.portHeldByOther ? `daemon: not running; port ${port} is held by another program` : 'daemon: not running (mr start)');
  ctx.print(`initialized: ${report.initialized ? 'yes' : 'no (mr init)'}`);
  ctx.print(`default routing mode: ${settings.routing.mode} (the Claude Code mod's own setting decides there)`);
  ctx.print(`privacy: ${settings.privacy.mode}`);
  ctx.print(db.value ? `decisions stored: ${db.value.total}${db.value.last ? `, last ${db.value.last}` : ''}` : 'decisions stored: none yet');
  for (const problem of report.problems) ctx.print(`problem: ${problem} (mr doctor)`);
  ctx.print(`install: ${ctx.layout.root} (${ctx.layout.kind})`);
  ctx.print(`config: ${ctx.paths.configFile}`);
  ctx.print(`database: ${ctx.paths.dbFile}`);
  return undefined;
}

function register(program, ctx) {
  program.command('start').description('start the local daemon that records routing decisions').action(() => start(ctx));
  program.command('stop').description('stop the local daemon').action(() => stop(ctx));
  program
    .command('status')
    .description('daemon, settings and stored decisions')
    .option('--json', 'machine-readable output')
    .action((options) => status(ctx, options));
}

module.exports = { register, probe, start, stop, status };
