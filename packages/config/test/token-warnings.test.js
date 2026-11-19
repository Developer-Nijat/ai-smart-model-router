'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readToken, ensureToken, tokensMatch, quietSqliteWarning } = require('../src');
const { ConfigError } = require('@smr/shared');

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-token-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('token', () => {
  it('creates a 256-bit token once and then reads it back', () => {
    const file = path.join(tmp, 'deep', 'token');
    expect(readToken(file)).toBeNull();
    const first = ensureToken(file);
    expect(first.created).toBe(true);
    expect(first.token).toMatch(/^[0-9a-f]{64}$/);
    expect(ensureToken(file)).toEqual({ token: first.token, created: false });
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('refuses a malformed token file', () => {
    const file = path.join(tmp, 'token');
    fs.writeFileSync(file, 'short');
    expect(() => readToken(file)).toThrow(ConfigError);
    expect(() => readToken(tmp)).toThrow(/Cannot read token file/);
  });

  it('refuses a token file others can read, on POSIX', () => {
    const file = path.join(tmp, 'token');
    fs.writeFileSync(file, 'a'.repeat(64), { mode: 0o644 });
    fs.chmodSync(file, 0o644);
    if (process.platform !== 'win32') expect(() => readToken(file)).toThrow(/readable by others/);
    expect(readToken(file, { platform: 'win32' })).toBe('a'.repeat(64));
  });

  it('answers a health nonce with an HMAC, and only a well-formed nonce', () => {
    const { healthProof } = require('../src');
    const crypto = require('node:crypto');
    const token = 'b'.repeat(64);
    const nonce = 'c'.repeat(32);
    expect(healthProof(token, nonce)).toBe(crypto.createHmac('sha256', token).update(`smr-health:${nonce}`).digest('hex'));
    expect(healthProof(token, 'short')).toBeNull();
    expect(healthProof(token, undefined)).toBeNull();
  });

  it('compares tokens in constant time and rejects non-strings', () => {
    const t = 'a'.repeat(64);
    expect(tokensMatch(t, t)).toBe(true);
    expect(tokensMatch('b'.repeat(64), t)).toBe(false);
    expect(tokensMatch('a', t)).toBe(false);
    expect(tokensMatch(undefined, t)).toBe(false);
  });
});

describe('quietSqliteWarning', () => {
  it('hides only the SQLite ExperimentalWarning', () => {
    const seen = [];
    const proc = { emitWarning: (w, type) => seen.push([w, type]) };
    const restore = quietSqliteWarning(proc);
    proc.emitWarning('SQLite is an experimental feature and might change at any time', 'ExperimentalWarning');
    proc.emitWarning(Object.assign(new Error('SQLite is experimental'), { name: 'ExperimentalWarning' }));
    proc.emitWarning('Fetch is experimental', 'ExperimentalWarning');
    proc.emitWarning('something deprecated', { type: 'DeprecationWarning' });
    expect(seen.map(([w]) => w)).toEqual(['Fetch is experimental', 'something deprecated']);
    restore();
    proc.emitWarning('SQLite x', 'ExperimentalWarning');
    expect(seen).toHaveLength(3);
  });
});
