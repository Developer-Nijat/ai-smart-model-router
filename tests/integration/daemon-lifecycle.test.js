'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);
const MR = path.join(__dirname, '..', '..', 'apps', 'cli', 'bin', 'mr.js');
const PORT = 3103;

/** The real `mr` binary, as a person runs it, against a private SMR_HOME. */
function mr(home, ...args) {
  return run(process.execPath, [MR, ...args], { env: { ...process.env, SMR_HOME: home }, timeout: 30_000 });
}

describe('mr init → start → record → history → stop (real processes)', () => {
  let home;
  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-e2e-'));
  });
  afterAll(async () => {
    // Never leave the daemon behind, whatever failed.
    await mr(home, 'stop').catch(() => undefined);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('runs the whole local loop', async () => {
    const init = await mr(home, 'init', '--json', '--show-token');
    const { modSettings } = JSON.parse(init.stdout);
    const token = modSettings.pluginConfigs['smart-model-router@inline'].options.daemonToken;
    expect(init.stderr).not.toMatch(/ExperimentalWarning/);

    await mr(home, 'config', 'set', 'server.port', String(PORT));
    expect((await mr(home, 'start')).stdout).toMatch(new RegExp(`started: pid \\d+, http://127\\.0\\.0\\.1:${PORT}`));
    expect((await mr(home, 'start')).stdout).toContain('already running');

    const record = {
      decision: {
        id: 'e2e:t1',
        sessionId: 'e2e',
        turnId: 't1',
        agentId: 'claude-code',
        mode: 'auto',
        selection: { model: 'anthropic.claude-haiku', effort: 'low' },
        reason: 'typo → haiku',
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
    const res = await fetch(`http://127.0.0.1:${PORT}/v1/records`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ records: [record] }),
    });
    expect(await res.json()).toEqual({ accepted: 1, duplicates: 0, rejected: [] });

    const history = JSON.parse((await mr(home, 'history', '--json')).stdout);
    expect(history.map((e) => e.id)).toEqual(['e2e:t1']);
    expect(JSON.parse((await mr(home, 'status', '--json')).stdout).daemon.running).toBe(true);

    // AC-12: the decision shows in the dashboard, signed in through mr dashboard.
    const link = (await mr(home, 'dashboard', '--no-open')).stdout;
    const code = /#code=([0-9a-f]{64})/.exec(link)[1];
    const origin = `http://127.0.0.1:${PORT}`;
    const signIn = await fetch(`${origin}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ code }) });
    const { session } = await signIn.json();
    const dashboardHistory = await (await fetch(`${origin}/api/history`, { headers: { 'x-smr-session': session } })).json();
    expect(dashboardHistory.map((e) => e.id)).toEqual(['e2e:t1']);
    const routing = await (await fetch(`${origin}/v1/routing`, { headers: { authorization: `Bearer ${token}` } })).json();
    expect(routing).toHaveProperty('tuning.weights');

    expect((await mr(home, 'stop')).stdout).toMatch(/stopped: pid \d+/);
    await expect(fetch(`http://127.0.0.1:${PORT}/health`)).rejects.toThrow();
    expect(fs.existsSync(path.join(home, 'server.pid'))).toBe(false);
  }, 60_000);

  it('exits 1 with one line on a failing command', async () => {
    await expect(mr(home, 'history', '--limit', 'x')).rejects.toMatchObject({ code: 1, stderr: 'mr: --limit must be a whole number from 1 to 500\n' });
  });
});
