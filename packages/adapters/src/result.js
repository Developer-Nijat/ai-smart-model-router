'use strict';

/**
 * Every adapter operation answers with one of these, never a bare value, so a
 * caller can always tell "done" from "this agent cannot do that" (AC-8).
 */

/** @returns {Readonly<{ ok: true, status: 'ok', value: unknown }>} */
function ok(value) {
  return Object.freeze({ ok: true, status: 'ok', value });
}

/** The agent cannot do this at all (a missing capability). Not an error. */
function unsupported(operation, reason) {
  return Object.freeze({ ok: false, status: 'unsupported', operation, reason });
}

/** The agent should be able to, but this attempt failed. */
function failed(operation, reason) {
  return Object.freeze({ ok: false, status: 'failed', operation, reason });
}

module.exports = { ok, unsupported, failed };
