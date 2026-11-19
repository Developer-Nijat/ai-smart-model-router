'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStorage } = require('@smr/storage');
const { readToken } = require('@smr/config');
const { createProgram } = require('../src/program');
const { createContext } = require('../src/context');
const { CliError } = require('../src/errors');
const { parseSince, parseCount, table } = require('../src/format');
const { getPath, setPath, parseValue } = require('../src/commands/setup');
const { nodeVersion } = require('../src/commands/doctor');
const { runBenchmark, loadPromptSet } = require('../src/commands/benchmark');

const NOW = new Date('2026-11-19T12:00:00.000Z');
const installed = (output) => async () => ({ found: true, output, error: null });
const missing = async () => ({ found: false, output: '', error: 'not found or failed to run' });
const noDaemon = async () => {
  throw new Error('ECONNREFUSED');
};

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-cli-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Runs `mr <args>` against a private SMR_HOME; returns what it printed. */
async function mr(args, overrides = {}) {
  const out = [];
  const err = [];
  const context = createContext({
    env: { SMR_HOME: tmp },
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    now: () => NOW,
    fetch: noDaemon,
    sleep: async () => {},
    detectors: { 'claude-code': installed('2.1.328 (Claude Code)'), codex: missing, 'gemini-cli': missing },
    modBundle: path.join(tmp, 'no-such-bundle.mjs'),
    dashboardDir: path.join(tmp, 'no-such-dashboard'),
    ...overrides,
  });
  const program = createProgram({ writeOut: (t) => out.push(t), writeErr: (t) => err.push(t), context });
  program.exitOverride();
  let error = null;
  try {
    await program.parseAsync(args, { from: 'user' });
  } catch (caught) {
    error = caught;
  }
  return { out: out.join(''), err: err.join(''), error, context };
}

function turn(id, extra = {}) {
  return {
    decision: {
      id,
      sessionId: 's1',
      turnId: id,
      agentId: 'claude-code',
      mode: 'auto',
      classification: { taskType: 'bug_fix', complexity: 0.2, reasoning: 'low', codingDepth: 'low', risk: 'low', scope: 'single_file', confidence: 0.8 },
      selection: { model: 'anthropic.claude-haiku', effort: 'low' },
      reason: 'bug_fix → anthropic.claude-haiku',
      decisionSource: 'classifier-rules',
      status: 'applied',
      appliedModel: 'claude-haiku-5-5',
      estimatedCostUsd: 0.0007,
      createdAt: '2026-11-19T10:00:00.000Z',
      ...extra,
    },
    verified: true,
    answeredBy: [extra.appliedModel ?? 'claude-haiku-5-5'],
    steps: 1,
    tokens: { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}

describe('mr init and config', () => {
  it('creates config, token and database, and prints the mod settings', async () => {
    const { out, context } = await mr(['init']);
    expect(out).toContain('created:');
    expect(out).toContain('schema 2');
    const token = readToken(context.paths.tokenFile);
    expect(out).not.toContain(token);
    expect(out).toContain('smart-model-router@inline');
    expect(out).toContain('secure storage');
    expect((await mr(['init'])).out).toContain('already initialized');
    const hidden = JSON.parse((await mr(['init', '--json'])).out);
    expect(hidden.modSettings.pluginConfigs['smart-model-router@inline'].options.daemonToken).toMatch(/show-token/);
    const json = JSON.parse((await mr(['init', '--json', '--show-token'])).out);
    expect(json.modSettings.pluginConfigs['smart-model-router@inline'].options).toMatchObject({ daemonUrl: 'http://127.0.0.1:4747', daemonToken: token });
  });

  it('lists, gets and sets settings with validation', async () => {
    await mr(['init']);
    expect(JSON.parse((await mr(['config', 'list', '--json'])).out).routing.mode).toBe('shadow');
    expect((await mr(['config', 'get', 'routing.mode'])).out).toBe('shadow\n');
    expect((await mr(['config', 'get', 'routing.sticky'])).out).toContain('"minScoreGain": 0.15');
    expect((await mr(['config', 'set', 'routing.mode', 'auto'])).out).toBe('routing.mode = "auto"\n');
    expect((await mr(['config', 'set', 'server.port', '3105'])).out).toBe('server.port = 3105\n');
    expect((await mr(['config', 'path'])).out.trim()).toMatch(/config\.json$/);

    const bad = await mr(['config', 'set', 'routing.mode', 'turbo']);
    expect(bad.error.message).toMatch(/invalid/i);
    expect((await mr(['config', 'get', 'routing.mode'])).out).toBe('auto\n');
    expect((await mr(['config', 'get', 'nope.key'])).error).toBeInstanceOf(CliError);
    expect((await mr(['config', 'set', 'nope', '1'])).error.message).toMatch(/no setting/);
    expect((await mr(['config', 'get', '../x'])).error.message).toMatch(/setting key/);
    expect((await mr(['config', 'set', 'routing.mode'])).error.message).toMatch(/set <key> <value>/);
    expect((await mr(['config', 'drop', 'routing.mode'])).error.message).toMatch(/unknown action/);
  });
});

describe('mr models, rules, agents', () => {
  it('lists models with sourced prices', async () => {
    const { out } = await mr(['models']);
    expect(out).toMatch(/haiku\s+haiku\s+1\s+enabled\s+0\.1\s+0\.5\s+2026-11-19/);
    expect(out).toContain('fable');
    expect(out).toContain('prices: https://platform.claude.com');
    const json = JSON.parse((await mr(['models', '--json'])).out);
    expect(json.find((m) => m.id === 'anthropic.claude-sonnet').price).toMatchObject({ inputPerMillion: 2, asOf: '2026-11-19' });
  });

  it('lists, validates and locates rules', async () => {
    expect((await mr(['rules'])).out).toContain('no routing rules');
    const { context } = await mr(['init']);
    const rule = { id: 'sec', name: 'security to opus', priority: 10, when: { taskTypes: ['security'] }, then: { model: 'anthropic.claude-opus' } };
    fs.writeFileSync(context.paths.rulesFile, JSON.stringify([rule]));
    expect((await mr(['rules', 'list'])).out).toMatch(/sec\s+10\s+user/);
    expect(JSON.parse((await mr(['rules', '--json'])).out)[0]).toMatchObject({ id: 'sec', source: 'user' });
    expect((await mr(['rules', 'validate'])).out).toContain('1 rule(s) valid');
    expect((await mr(['rules', 'path'])).out.trim()).toBe(context.paths.rulesFile);

    const badFile = path.join(tmp, 'bad.json');
    fs.writeFileSync(badFile, JSON.stringify([{ id: 'x', name: 'x', when: {}, then: {} }]));
    expect((await mr(['rules', 'validate', badFile])).error.message).toMatch(/at least one condition/);
    fs.writeFileSync(badFile, '{}');
    expect((await mr(['rules', 'validate', badFile])).error.message).toMatch(/JSON array/);
    expect((await mr(['rules', 'validate', path.join(tmp, 'none.json')])).error.message).toMatch(/no such file/);
    expect((await mr(['rules', 'zap'])).error.message).toMatch(/unknown action/);
  });

  it('detects agents and stores what it found', async () => {
    const { out, context } = await mr(['agents']);
    expect(out).toMatch(/claude-code\s+yes\s+2\.1\.328\s+turn \+ subagent \+ effort/);
    expect(out).toMatch(/codex\s+no/);
    const stored = openStorage(context.paths.dbFile);
    expect(stored.agents.list().map((a) => [a.id, a.installed])).toEqual([
      ['claude-code', true],
      ['codex', false],
      ['gemini-cli', false],
    ]);
    stored.close();
    expect(JSON.parse((await mr(['agents', '--json'])).out)).toHaveLength(3);
  });
});

describe('mr stats and history', () => {
  async function seed() {
    const { context } = await mr(['init']);
    const storage = openStorage(context.paths.dbFile);
    storage.records.ingest([
      turn('a'),
      turn('b', { status: 'failed', appliedModel: 'claude-opus-5-5', createdAt: '2026-11-18T10:00:00.000Z', estimatedCostUsd: null }),
      turn('old', { createdAt: '2026-09-01T10:00:00.000Z' }),
    ]);
    storage.close();
  }

  it('says when there is nothing yet', async () => {
    expect((await mr(['stats'])).out).toContain('no data yet');
    expect((await mr(['history'])).out).toContain('no data yet');
    await mr(['init']);
    expect((await mr(['history'])).out).toContain('no routed turns yet');
    expect((await mr(['stats'])).out).toContain('no routed turns in this period');
  });

  it('aggregates a period, with a same-tokens price comparison', async () => {
    await seed();
    const { out } = await mr(['stats']);
    expect(out).toContain('turns: 2 (2 main, 0 subagent)');
    expect(out).toMatch(/claude-haiku-5-5\s+1\s+50%/);
    expect(out).toContain('estimated cost: $0.0007 + 1 turn(s) with an unknown price');
    // 1000 in + 1000 out per turn, two turns: haiku 0.1/0.5 → 0.0012; opus 4/20 → 0.048.
    expect(out).toContain('haiku: $0.0012');
    expect(out).toContain('opus: $0.0480');
    expect((await mr(['stats', '--since', 'all'])).out).toContain('turns: 3');
    const json = JSON.parse((await mr(['stats', '--since', '24h', '--json'])).out);
    expect(json.total).toBe(1);
    expect(json.comparison.actualUsd).toBeCloseTo(0.0006, 8);
    expect(json.comparison.excludedTurns).toBe(0);
    expect((await mr(['stats', '--since', 'yesterday'])).error.message).toMatch(/--since/);
  });

  it('lists history newest first with filters', async () => {
    await seed();
    const { out } = await mr(['history', '--reasons']);
    const lines = out.trim().split('\n');
    expect(lines[0]).toMatch(/^time\s+who/);
    expect(lines[1]).toMatch(/2026-11-19 10:00:00\s+main\s+auto\s+applied\s+haiku\/low\s+claude-haiku-5-5\s+bug_fix\s+\$0\.0007/);
    expect(out).toContain('a: bug_fix → anthropic.claude-haiku');
    expect(JSON.parse((await mr(['history', '--status', 'failed', '--json'])).out).map((e) => e.id)).toEqual(['b']);
    expect(JSON.parse((await mr(['history', '--limit', '1', '--json'])).out)).toHaveLength(1);
    expect(JSON.parse((await mr(['history', '--since', '7d', '--json'])).out)).toHaveLength(2);
    expect((await mr(['history', '--limit', '0'])).error.message).toMatch(/--limit/);
  });
});

describe('mr status, start and stop without a daemon', () => {
  it('reports a stopped daemon and an uninitialised setup', async () => {
    const { out } = await mr(['status']);
    expect(out).toContain('daemon: not running');
    expect(out).toContain('initialized: no (mr init)');
    expect(out).toContain('decisions stored: none yet');
    const json = JSON.parse((await mr(['status', '--json'])).out);
    expect(json.daemon).toEqual({ running: false, portHeldByOther: false, stalePid: null });
  });

  it('stop is a no-op and clears a stale pid file', async () => {
    const { context } = await mr(['init']);
    fs.writeFileSync(context.paths.pidFile, '999999');
    expect((await mr(['stop'])).out).toBe('not running\n');
    expect(fs.existsSync(context.paths.pidFile)).toBe(false);
  });

  it('start fails clearly when the daemon never answers', async () => {
    const spawned = [];
    const spawn = (...args) => {
      spawned.push(args);
      return { unref() {} };
    };
    const { error } = await mr(['start'], { spawn });
    expect(error.message).toMatch(/did not start on port 4747/);
    expect(spawned[0][1][1]).toBe('--log-file');
    expect(spawned[0][2]).toMatchObject({ detached: true, stdio: 'ignore', windowsHide: true });
  });

  it('ignores something else answering on the port', async () => {
    const other = async () => ({ ok: true, json: async () => ({ service: 'something-else' }) });
    expect((await mr(['status'], { fetch: other })).out).toContain('daemon: not running (mr start)');
  });

  it('never trusts, stops or kills an impostor that cannot prove the token', async () => {
    await mr(['init']);
    const calls = [];
    const impostor = async (url, init) => {
      calls.push([url, init?.headers?.authorization]);
      return { ok: true, json: async () => ({ service: 'smart-model-router', pid: 4242, proof: 'f'.repeat(64) }) };
    };
    const kill = vi.fn();
    const stopped = await mr(['stop'], { fetch: impostor, kill });
    expect(stopped.error.message).toMatch(/did not prove/);
    expect(kill).not.toHaveBeenCalled();
    expect(calls.every(([url, auth]) => url.includes('/health?nonce=') && auth === undefined)).toBe(true);
    expect((await mr(['start'], { fetch: impostor })).error.message).toMatch(/did not prove/);
    expect((await mr(['status'], { fetch: impostor })).out).toContain('held by another program');
    const doctor = await mr(['doctor', '--json'], { fetch: impostor });
    expect(JSON.parse(doctor.out).checks.find((c) => c.name === 'daemon').status).toBe('fail');
  });

  it('stops a verified daemon, killing only the pid its own pid file names', async () => {
    const { context } = await mr(['init']);
    const { healthProof } = require('@smr/config');
    const token = readToken(context.paths.tokenFile);
    let alive = true;
    const daemon = async (url) => {
      if (!alive) throw new Error('ECONNREFUSED');
      if (url.includes('/v1/shutdown')) return { ok: true, json: async () => ({ ok: true }) };
      const nonce = new URL(url).searchParams.get('nonce');
      return { ok: true, json: async () => ({ service: 'smart-model-router', pid: 4242, proof: healthProof(token, nonce) }) };
    };
    const kill = vi.fn(() => {
      alive = false;
    });
    fs.writeFileSync(context.paths.pidFile, '9999');
    expect((await mr(['stop'], { fetch: daemon, kill })).error.message).toMatch(/did not stop/);
    expect(kill).not.toHaveBeenCalled();
    fs.writeFileSync(context.paths.pidFile, '4242');
    expect((await mr(['stop'], { fetch: daemon, kill })).out).toBe('stopped: pid 4242\n');
    expect(kill).toHaveBeenCalledWith(4242);
    alive = true;
    expect((await mr(['start'], { fetch: daemon })).out).toContain('already running: pid 4242');
  });

  it('reports a malformed token instead of failing', async () => {
    const { context } = await mr(['init']);
    fs.writeFileSync(context.paths.tokenFile, 'nope');
    const { out, error } = await mr(['status']);
    expect(error).toBeNull();
    expect(out).toMatch(/problem: Token file .* malformed/);
  });

  it('reports a spawn failure in one line', async () => {
    const spawn = () => ({
      unref() {},
      on(event, handler) {
        if (event === 'error') handler(new Error('spawn EPERM'));
      },
    });
    expect((await mr(['start'], { spawn })).error.message).toBe('could not start the daemon: spawn EPERM');
  });
});

describe('mr doctor', () => {
  it('passes on a fresh setup with warnings, and lists every check', async () => {
    await mr(['init']);
    const { out, error } = await mr(['doctor']);
    expect(error).toBeNull();
    for (const name of ['node', 'settings', 'token', 'database', 'registry', 'rules', 'daemon', 'claude-code', 'mod']) expect(out).toContain(name);
    expect(out).toMatch(/warn\s+daemon/);
    expect(out).toMatch(/warn\s+mod\s+not built/);
    expect(out).toMatch(/warn\s+dashboard\s+not built/);
    const built = path.join(tmp, 'dash');
    fs.mkdirSync(built);
    fs.writeFileSync(path.join(built, 'index.html'), '<!doctype html>');
    expect((await mr(['doctor'], { dashboardDir: built })).out).toMatch(/ok\s+dashboard/);
    expect(out).toMatch(/ok\s+claude-code\s+version 2\.1\.328/);
  });

  it('warns when others can read the token file on Windows', async () => {
    await mr(['init']);
    const aclReport = () => ({ principals: ['me', 'BUILTIN\\Users'], others: ['BUILTIN\\Users'] });
    const { out } = await mr(['doctor'], { platform: 'win32', aclReport });
    expect(out).toMatch(/warn\s+token\s+.*readable by BUILTIN\\Users: run mr init/);
    const clean = await mr(['doctor'], { platform: 'win32', aclReport: () => ({ principals: ['me'], others: [] }) });
    expect(clean.out).toMatch(/ok\s+token\s+.*\(owner only\)/);
    expect((await mr(['doctor'], { platform: 'linux' })).out).not.toMatch(/owner only/);
  });

  it('fails on a broken settings file and says so', async () => {
    const { context } = await mr(['init']);
    fs.writeFileSync(context.paths.configFile, '{ broken');
    const { out, error } = await mr(['doctor', '--json']);
    expect(error.message).toMatch(/check\(s\) failed/);
    expect(JSON.parse(out).checks.find((c) => c.name === 'settings').status).toBe('fail');
  });

  it('judges the node version', () => {
    expect(nodeVersion('v22.13.0').status).toBe('ok');
    expect(nodeVersion('v24.1.0').status).toBe('ok');
    expect(nodeVersion('v22.12.9').status).toBe('fail');
    expect(nodeVersion('v20.18.0').status).toBe('fail');
  });
});

describe('mr benchmark', () => {
  it('compares the router with fixed strategies and stores the run', async () => {
    await mr(['init']);
    const { out, context } = await mr(['benchmark']);
    expect(out).toMatch(/router\s+\d+\/30/);
    expect(out).toMatch(/always-haiku\s+10\/30 \(33%\)\s+20\s+0/);
    expect(out).toMatch(/always-opus\s+10\/30 \(33%\)\s+0\s+20\s+1/);
    expect(out).toContain('No model was called');
    const storage = openStorage(context.paths.dbFile);
    const [run] = storage.benchmarks.recent();
    storage.close();
    expect(run.summary.results.find((r) => r.strategy === 'router').rows).toHaveLength(30);
    expect(run.summary.results.find((r) => r.strategy === 'always-opus').rows).toBeUndefined();
  });

  it('keeps the router ahead of every fixed strategy on the shipped set', async () => {
    const { context } = await mr(['models']);
    const set = loadPromptSet(path.join(context.dataDir, 'benchmark', 'prompts.json'));
    const summary = runBenchmark({ registry: context.registry(), rules: [], set, day: '2026-11-19', createdAt: NOW.toISOString() });
    const router = summary.results.find((r) => r.strategy === 'router');
    for (const fixed of summary.results.filter((r) => r.strategy !== 'router')) expect(router.match).toBeGreaterThan(fixed.match);
    // A quality floor: the router may send at most a tenth of tasks to a weaker tier than labelled.
    expect(router.under).toBeLessThanOrEqual(3);
  });

  it('refuses a malformed prompt set', async () => {
    const file = path.join(tmp, 'set.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, labels: 'x', prompts: [{ id: 'a', expected: 'gpt', text: 'x' }] }));
    expect((await mr(['benchmark', '--file', file])).error.message).toMatch(/not a prompt set/);
    expect((await mr(['benchmark', '--file', path.join(tmp, 'none.json')])).error.message).toMatch(/no such file/);
  });

  it('runs without a database and prints JSON', async () => {
    const json = JSON.parse((await mr(['benchmark', '--json'])).out);
    expect(json.prompts).toBe(30);
    expect(json.reference).toBe('anthropic.claude-opus');
  });
});

describe('helpers', () => {
  it('parses periods and counts', () => {
    expect(parseSince('7d', NOW)).toBe('2026-11-12T12:00:00.000Z');
    expect(parseSince('24h', NOW)).toBe('2026-11-18T12:00:00.000Z');
    expect(parseSince('2w', NOW)).toBe('2026-11-05T12:00:00.000Z');
    expect(parseSince('all', NOW)).toBeNull();
    expect(() => parseSince('1y', NOW)).toThrow(CliError);
    expect(parseCount('5', { name: 'n', max: 10 })).toBe(5);
    expect(() => parseCount('11', { name: 'n', max: 10 })).toThrow(/from 1 to 10/);
  });

  it('reads and writes dotted paths without mutating', () => {
    const settings = { routing: { mode: 'shadow' } };
    expect(getPath(settings, 'routing.mode')).toBe('shadow');
    expect(getPath(settings, 'routing.constructor')).toBeUndefined();
    const next = setPath(settings, 'routing.mode', 'auto');
    expect(next.routing.mode).toBe('auto');
    expect(settings.routing.mode).toBe('shadow');
    expect(setPath({}, 'a.b', 1)).toEqual({ a: { b: 1 } });
    expect([parseValue('true'), parseValue('3'), parseValue('auto'), parseValue('null')]).toEqual([true, 3, 'auto', null]);
  });

  it('formats tables', () => {
    expect(table(['a', 'bb'], [['xxx', null]])).toBe('a    bb\nxxx  -');
  });
});
