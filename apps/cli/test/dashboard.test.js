'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { readToken, healthProof } = require('@smr/config');
const { createContext, openInBrowser } = require('../src/context');
const { createProgram } = require('../src/program');

const CODE = 'c'.repeat(64);
let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-cli-dash-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function mr(args, overrides = {}) {
  const out = [];
  const context = createContext({ env: { SMR_HOME: tmp }, out: (t) => out.push(t), err: () => undefined, sleep: async () => undefined, ...overrides });
  const program = createProgram({ writeOut: (t) => out.push(t), writeErr: () => undefined, context });
  program.exitOverride();
  let error = null;
  try {
    await program.parseAsync(['node', 'mr', ...args]);
  } catch (e) {
    error = e;
  }
  return { out: out.join(''), error, context };
}

/** A daemon that proves the token and answers the code request as `codeAnswer` says. */
function daemon(context, codeAnswer = { status: 200, body: { code: CODE } }) {
  const token = readToken(context.paths.tokenFile);
  const calls = [];
  const fetch = async (url, init) => {
    calls.push([url, init?.headers?.authorization]);
    if (url.includes('/health')) {
      const nonce = new URL(url).searchParams.get('nonce');
      return { ok: true, status: 200, json: async () => ({ service: 'smart-model-router', pid: 4242, proof: healthProof(token, nonce) }) };
    }
    return { ok: codeAnswer.status === 200, status: codeAnswer.status, json: async () => codeAnswer.body };
  };
  return { fetch, calls, token };
}

describe('mr dashboard', () => {
  it('opens the dashboard with a one-time code, never the token', async () => {
    const { context } = await mr(['init']);
    const { fetch, calls, token } = daemon(context);
    const openUrl = vi.fn(async () => undefined);
    const { out, error } = await mr(['dashboard'], { fetch, openUrl });
    expect(error).toBeNull();
    expect(openUrl).toHaveBeenCalledWith(`http://127.0.0.1:4747/#code=${CODE}`);
    expect(out).toBe('opened http://127.0.0.1:4747 in your browser\n');
    expect(calls.at(-1)).toEqual(['http://127.0.0.1:4747/v1/dashboard/code', `Bearer ${token}`]);
    expect(openUrl.mock.calls[0][0]).not.toContain(token);
  });

  it('prints the link with --no-open, or when no browser opens', async () => {
    const { context } = await mr(['init']);
    const { fetch } = daemon(context);
    expect((await mr(['dashboard', '--no-open'], { fetch })).out).toContain(`#code=${CODE}\none-time link`);
    const failing = await mr(['dashboard'], { fetch, openUrl: async () => Promise.reject(new Error('no display')) });
    expect(failing.out).toMatch(/could not open a browser \(no display\)[\s\S]*#code=/);
  });

  it('refuses without a verified daemon, and on a bad answer', async () => {
    const { context } = await mr(['init']);
    const down = async () => {
      throw new Error('ECONNREFUSED');
    };
    expect((await mr(['dashboard'], { fetch: down })).error.message).toBe('the daemon is not running: mr start');
    const impostor = async () => ({ ok: true, json: async () => ({ service: 'smart-model-router', pid: 1, proof: 'f'.repeat(64) }) });
    expect((await mr(['dashboard'], { fetch: impostor })).error.message).toMatch(/did not prove/);
    expect((await mr(['dashboard'], { fetch: daemon(context, { status: 404, body: {} }).fetch })).error.message).toMatch(/no dashboard/);
    expect((await mr(['dashboard'], { fetch: daemon(context, { status: 500, body: {} }).fetch })).error.message).toMatch(/refused/);
    expect((await mr(['dashboard'], { fetch: daemon(context, { status: 200, body: { code: '<script>' } }).fetch })).error.message).toMatch(/malformed/);
  });
});

describe('openInBrowser', () => {
  const fakeSpawner = (event) => {
    const calls = [];
    const spawner = (command, args) => {
      calls.push([command, args]);
      const child = new EventEmitter();
      child.unref = () => undefined;
      setImmediate(() => child.emit(event, new Error('ENOENT')));
      return child;
    };
    return { spawner, calls };
  };

  it('passes the URL as one argument, never through a shell', async () => {
    for (const [platform, command] of [['win32', 'rundll32'], ['darwin', 'open'], ['linux', 'xdg-open']]) {
      const { spawner, calls } = fakeSpawner('spawn');
      await openInBrowser('http://127.0.0.1:4747/#code=x&y', { platform, spawner });
      expect(calls[0][0]).toBe(command);
      expect(calls[0][1].at(-1)).toBe('http://127.0.0.1:4747/#code=x&y');
    }
  });

  it('rejects when the opener cannot start', async () => {
    const { spawner } = fakeSpawner('error');
    await expect(openInBrowser('http://x', { platform: 'linux', spawner })).rejects.toThrow('ENOENT');
  });
});
