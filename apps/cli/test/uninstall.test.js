'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createContext } = require('../src/context');
const { createProgram } = require('../src/program');

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-uninstall-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const down = async () => {
  throw new Error('ECONNREFUSED');
};

async function mr(args, home = tmp) {
  const out = [];
  const context = createContext({ env: { SMR_HOME: home }, out: (t) => out.push(t), err: () => undefined, fetch: down, sleep: async () => undefined });
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

describe('mr uninstall', () => {
  it('purges even when config.json is broken, and removes leftover temp files', async () => {
    const { context } = await mr(['init']);
    fs.writeFileSync(context.paths.configFile, '{ broken');
    const temp = path.join(path.dirname(context.paths.configFile), '.config.json.0123456789ab.tmp');
    fs.writeFileSync(temp, '{}');
    const { out, error } = await mr(['uninstall', '--purge', '--yes']);
    expect(error).toBeNull();
    expect(out).toContain('could not stop the daemon');
    expect(fs.existsSync(context.paths.configFile)).toBe(false);
    expect(fs.existsSync(temp)).toBe(false);
  });

  it('keeps the data unless asked, and says how to finish', async () => {
    const { context } = await mr(['init']);
    const { out, error } = await mr(['uninstall']);
    expect(error).toBeNull();
    expect(out).toMatch(/kept your data \(\d+ file\(s\)\)/);
    expect(out).toContain('npm uninstall -g smart-model-router');
    expect(out).toContain('claude plugin uninstall smart-model-router@smart-model-router-local');
    expect(fs.existsSync(context.paths.tokenFile)).toBe(true);
  });

  it('lists what --purge would delete and deletes nothing without --yes', async () => {
    const { context } = await mr(['init']);
    const { out, error } = await mr(['uninstall', '--purge']);
    expect(error.message).toBe('add --yes to delete them');
    expect(out).toContain(context.paths.tokenFile);
    expect(fs.existsSync(context.paths.dbFile)).toBe(true);
  });

  it('deletes only its own files, backups and logs, and keeps anything else in a shared folder', async () => {
    const { context } = await mr(['init']);
    const { paths } = context;
    fs.writeFileSync(`${paths.dbFile}.bak-v1-2026-11-19T10-00-00-000Z`, 'old');
    fs.mkdirSync(paths.logDir, { recursive: true });
    fs.writeFileSync(paths.serverLogFile, 'log');
    fs.writeFileSync(path.join(tmp, 'my-notes.txt'), 'not ours');
    fs.writeFileSync(path.join(paths.logDir, 'other.txt'), 'not ours either');
    const { out, error } = await mr(['uninstall', '--purge', '--yes']);
    expect(error).toBeNull();
    expect(out).toMatch(/deleted \d+ file\(s\)/);
    expect(fs.readdirSync(tmp).sort()).toEqual(['logs', 'my-notes.txt']);
    expect(fs.readdirSync(paths.logDir)).toEqual(['other.txt']);
  });

  it('removes the folders when they end up empty', async () => {
    const home = path.join(tmp, 'smr-home');
    await mr(['init'], home);
    await mr(['uninstall', '--purge', '--yes'], home);
    expect(fs.existsSync(home)).toBe(false);
  });
});
