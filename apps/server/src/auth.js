'use strict';

const crypto = require('node:crypto');

const CODE_TTL_MS = 60_000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_CODES = 10;
const MAX_SESSIONS = 20;
const SECRET_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Dashboard sign-in without putting the API token in a browser.
 *
 * `mr dashboard` (holding the token) asks the daemon for a one-time code that lives a
 * minute; the browser trades it for a session key that lives twelve hours and is kept
 * in the tab's sessionStorage, which is private to this origin (scheme, host and port)
 * — unlike a cookie, which the browser would also send to other local ports.
 *
 * @param {{ now?: () => number, random?: () => string }} [options]
 */
function createDashboardAuth(options = {}) {
  const now = options.now ?? Date.now;
  const random = options.random ?? (() => crypto.randomBytes(32).toString('hex'));
  const codes = new Map();
  const sessions = new Map();

  /** Drops expired entries, then the oldest ones beyond `max` (Maps keep insertion order). */
  function prune(map, max) {
    const t = now();
    for (const [key, expires] of map) if (expires <= t) map.delete(key);
    while (map.size > max) map.delete(map.keys().next().value);
  }

  function take(map, key) {
    if (typeof key !== 'string' || !SECRET_PATTERN.test(key)) return false;
    const expires = map.get(key);
    if (expires === undefined) return false;
    if (expires <= now()) {
      map.delete(key);
      return false;
    }
    return true;
  }

  return Object.freeze({
    issueCode() {
      const code = random();
      codes.set(code, now() + CODE_TTL_MS);
      prune(codes, MAX_CODES);
      return { code, expiresInMs: CODE_TTL_MS };
    },
    /** A valid code, once: the session key, else null. */
    exchange(code) {
      if (!take(codes, code)) return null;
      codes.delete(code);
      const session = random();
      sessions.set(session, now() + SESSION_TTL_MS);
      prune(sessions, MAX_SESSIONS);
      return { session, expiresInMs: SESSION_TTL_MS };
    },
    check(session) {
      return take(sessions, session);
    },
    revoke(session) {
      if (typeof session === 'string') sessions.delete(session);
    },
  });
}

module.exports = { createDashboardAuth, CODE_TTL_MS, SESSION_TTL_MS, MAX_SESSIONS };
