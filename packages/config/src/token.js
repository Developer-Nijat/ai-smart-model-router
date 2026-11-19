'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ConfigError } = require('@smr/shared');
const { restrictToOwner } = require('./winacl');

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const NONCE_PATTERN = /^[0-9a-f]{32,64}$/;

/**
 * On POSIX a token file must be a regular file only its owner can read: a planted,
 * world-readable or symlinked file is refused. On Windows ensureToken gives the file an
 * owner-only ACL and `mr doctor` checks it (see winacl.js).
 */
function checkPrivate(file, platform) {
  if (platform === 'win32') return;
  const stat = fs.lstatSync(file);
  if (!stat.isFile()) throw new ConfigError(`Token file ${file} is not a regular file`, { file });
  if ((stat.mode & 0o077) !== 0) throw new ConfigError(`Token file ${file} is readable by others; run chmod 600 on it`, { file });
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new ConfigError(`Token file ${file} belongs to another user`, { file });
  }
}

/**
 * Reads the local API token; null when there is none yet.
 * A file that does not hold a well-formed token is an error, never used.
 *
 * @param {string} file
 * @param {{ platform?: string }} [options]
 * @returns {string | null}
 */
function readToken(file, options = {}) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8').trim();
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new ConfigError(`Cannot read token file ${file}: ${error.message}`, { file });
  }
  if (!TOKEN_PATTERN.test(text)) throw new ConfigError(`Token file ${file} is malformed; delete it and run mr init`, { file });
  checkPrivate(file, options.platform ?? process.platform);
  return text;
}

/** Reads a token another process is creating: its file exists but may be empty a moment. */
function readFreshToken(file, platform) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return readToken(file, { platform });
    } catch (error) {
      if (attempt === 19) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  return null;
}

/**
 * Returns the token, creating it (256 random bits, owner-only file) on first use.
 * `wx` makes creation exclusive: two processes starting together end with one token.
 *
 * On Windows (where file modes do nothing) a new file is created empty, narrowed to its
 * owner, and only then given the token; if it cannot be narrowed it is deleted and this
 * throws. An existing token is narrowed again best effort (a token from an older
 * version gets it too); `mr doctor` reports one it could not narrow.
 *
 * @param {string} file
 * @param {{ platform?: string, restrict?: (file: string) => void }} [options]
 * @returns {{ token: string, created: boolean }}
 */
function ensureToken(file, options = {}) {
  const platform = options.platform ?? process.platform;
  const restrict = options.restrict ?? restrictToOwner;
  const windows = platform === 'win32';
  const existing = readToken(file, { platform });
  if (existing) {
    if (windows) {
      try {
        restrict(file);
      } catch {
        // Reported by mr doctor.
      }
    }
    return { token: existing, created: false };
  }
  const token = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, windows ? '' : `${token}\n`, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') return { token: readFreshToken(file, platform), created: false };
    throw new ConfigError(`Cannot write token file ${file}: ${error.message}`, { file });
  }
  if (windows) {
    try {
      restrict(file);
    } catch (error) {
      fs.rmSync(file, { force: true });
      throw new ConfigError(`Cannot restrict token file ${file} to you: ${error.message}`, { file });
    }
    // Truncating keeps the narrowed ACL.
    fs.writeFileSync(file, `${token}\n`, { flag: 'w' });
  }
  return { token, created: true };
}

/** Constant-time comparison of a presented token with the real one. */
function tokensMatch(presented, actual) {
  if (typeof presented !== 'string' || typeof actual !== 'string') return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(actual);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * The daemon's answer to a health check nonce: HMAC-SHA256(token, "smr-health:" + nonce).
 * A client checks it before sending the token anywhere, so whatever else holds the port
 * learns nothing and is never trusted (stop, kill, records).
 *
 * @returns {string | null} null when the nonce is not 32-64 lowercase hex characters
 */
function healthProof(token, nonce) {
  if (typeof nonce !== 'string' || !NONCE_PATTERN.test(nonce)) return null;
  return crypto.createHmac('sha256', token).update(`smr-health:${nonce}`).digest('hex');
}

module.exports = { readToken, ensureToken, tokensMatch, healthProof, TOKEN_PATTERN, NONCE_PATTERN };
