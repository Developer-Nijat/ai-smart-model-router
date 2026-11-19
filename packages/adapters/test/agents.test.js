'use strict';

const {
  ClaudeCodeAdapter,
  CodexAdapter,
  GeminiCliAdapter,
  runVersion,
  parseVersion,
  compareVersions,
  detectCli,
} = require('../src');

const installed = (output) => async () => ({ found: true, output, error: null });
const missing = async () => ({ found: false, output: '', error: 'not found or failed to run' });

describe('version helpers', () => {
  it('parses and compares x.y.z', () => {
    expect(parseVersion('2.1.328 (Claude Code)')).toBe('2.1.328');
    expect(parseVersion('no version')).toBeNull();
    expect(compareVersions('2.1.328', '2.1.327')).toBe(1);
    expect(compareVersions('2.1.9', '2.1.10')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('detectCli reports missing, unrecognised, too old and supported', async () => {
    expect(await detectCli({ command: 'x', runner: missing })).toMatchObject({ installed: false, supported: false });
    expect(await detectCli({ command: 'x', runner: installed('weird') })).toMatchObject({ installed: true, version: null, supported: false });
    expect(await detectCli({ command: 'x', minVersion: '2.1.327', runner: installed('2.1.300') })).toMatchObject({
      supported: false,
      notes: [expect.stringMatching(/older than 2\.1\.327/)],
    });
    expect(await detectCli({ command: 'x', minVersion: '2.1.327', runner: installed('2.1.327') })).toMatchObject({ supported: true, version: '2.1.327' });
  });
});

describe('runVersion', () => {
  it('runs `<command> --version` without a shell off Windows', async () => {
    const run = vi.fn((cmd, args, opts, cb) => cb(null, ' 1.2.3 \n'));
    expect(await runVersion('claude', { run, platform: 'linux' })).toEqual({ found: true, output: '1.2.3', error: null });
    expect(run.mock.calls[0][0]).toBe('claude');
    expect(run.mock.calls[0][1]).toEqual(['--version']);
    expect(run.mock.calls[0][2]).toMatchObject({ shell: false, windowsHide: true });
  });

  it('uses a shell on Windows for .cmd shims, as one line, outside the current folder', async () => {
    const run = vi.fn((cmd, args, opts, cb) => cb(null, '1.0.0'));
    await runVersion('codex', { run, platform: 'win32' });
    expect(run.mock.calls[0][0]).toBe('codex --version');
    expect(run.mock.calls[0][1]).toEqual([]);
    expect(run.mock.calls[0][2]).toMatchObject({ shell: true, cwd: require('node:os').homedir() });
  });

  it('never runs a command name that is not a plain word', async () => {
    const run = vi.fn();
    expect(await runVersion('claude & calc', { run })).toEqual({ found: false, output: '', error: 'invalid command name' });
    expect(run).not.toHaveBeenCalled();
  });

  it('reports errors and timeouts without rejecting', async () => {
    const fail = (error) => (cmd, args, opts, cb) => cb(error, '');
    expect((await runVersion('x', { run: fail(Object.assign(new Error('nope'), { code: 'ENOENT' })) })).error).toBe('not found or failed to run');
    expect((await runVersion('x', { run: fail(Object.assign(new Error('slow'), { killed: true })) })).error).toBe('timed out');
    expect((await runVersion('x', { run: fail(Object.assign(new Error('big'), { killed: true, code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })) })).error).toBe('output too large');
    const throwing = () => {
      throw new Error('spawn failed');
    };
    expect((await runVersion('x', { run: throwing })).error).toBe('failed to start');
  });

  it('finds the real node binary', async () => {
    const result = await runVersion('node');
    expect(result.found).toBe(true);
    expect(parseVersion(result.output)).not.toBeNull();
  });
});

describe('ClaudeCodeAdapter', () => {
  it('claims the verified capabilities only', () => {
    const adapter = new ClaudeCodeAdapter();
    expect(adapter.capabilities).toMatchObject({ turnLevelRouting: true, subagentRouting: true, effortControl: true, startupModelSelection: false });
    expect(adapter.supports('applyModel')).toBe(true);
    expect(adapter.supports('applyStartupModel')).toBe(false);
  });

  it('detects a supported install and points at the mod', async () => {
    const info = await new ClaudeCodeAdapter({ runner: installed('2.1.328 (Claude Code)') }).detectInstallation();
    expect(info).toMatchObject({ installed: true, version: '2.1.328' });
    expect(info.notes.join(' ')).toMatch(/smart-model-router mod/);
    const old = await new ClaudeCodeAdapter({ runner: installed('2.0.1') }).detectInstallation();
    expect(old.notes.join(' ')).toMatch(/older than/);
  });

  it('lists models from the registry and refuses live-session operations honestly', async () => {
    const registry = { candidatesFor: () => [{ id: 'anthropic.claude-haiku', agentModelIds: { 'claude-code': 'haiku' } }] };
    const adapter = new ClaudeCodeAdapter({ registry });
    expect((await adapter.getAvailableModels()).value).toEqual([{ id: 'anthropic.claude-haiku', agentModelId: 'haiku' }]);
    expect((await new ClaudeCodeAdapter().getAvailableModels()).status).toBe('failed');
    for (const op of ['getCurrentModel', 'applyModel', 'getSessionContext', 'getUsage', 'registerCommands']) {
      const result = await adapter[op]();
      expect(result.status).toBe('failed');
      expect(result.reason).toMatch(/mod|session/);
    }
  });
});

describe('detection-only adapters', () => {
  it.each([
    [CodexAdapter, 'codex', 'OpenAI Codex CLI'],
    [GeminiCliAdapter, 'gemini-cli', 'Gemini CLI'],
  ])('%o claims nothing and says so', async (Adapter, id, name) => {
    const adapter = new Adapter({ runner: installed('9.9.9') });
    expect(adapter.id).toBe(id);
    expect(Object.values(adapter.capabilities).every((v) => v === false)).toBe(true);
    const info = await adapter.detectInstallation();
    expect(info).toMatchObject({ installed: true, version: '9.9.9' });
    expect(info.notes.join(' ')).toContain(`${name}: detection only`);
    expect((await new Adapter({ runner: missing }).detectInstallation()).installed).toBe(false);
    expect((await adapter.applyModel('x')).status).toBe('unsupported');
  });
});
