'use strict';

const DEFAULT_DAEMON_URL = 'http://127.0.0.1:4747';
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const BATCH_SIZE = 50;
const SHA256_BLOCK = 64;
const NONCE_BYTES = 16;

/**
 * Where the mod sends its records, from userConfig. Records go only to a loopback
 * daemon: any other address is refused, so a mistyped setting can never send session
 * data off the machine. No token → buffering only (`mr init` prints the token).
 *
 * @param {Record<string, unknown>} [options]
 * @returns {{ base: string, endpoint: string, token: string } | { disabled: string }}
 */
function daemonTarget(options = {}) {
  const token = typeof options.daemonToken === 'string' ? options.daemonToken.trim() : '';
  if (token === '') return { disabled: 'no daemon token set (run mr init)' };
  if (!TOKEN_PATTERN.test(token)) return { disabled: 'daemon token is malformed' };
  const raw = typeof options.daemonUrl === 'string' && options.daemonUrl.trim() !== '' ? options.daemonUrl.trim() : DEFAULT_DAEMON_URL;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { disabled: 'daemon URL is not a URL' };
  }
  if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname) || url.username || url.password) {
    return { disabled: 'daemon URL must be http on 127.0.0.1, localhost or [::1]' };
  }
  const base = `${url.protocol}//${url.host}`;
  return { base, endpoint: `${base}/v1/records`, token };
}

function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * HMAC-SHA256 (RFC 2104) over a SHA-256 digest function. The mod's runtime offers
 * `crypto.subtle.digest` but no HMAC, so it is built here; tests compare it with Node's.
 *
 * @param {string} key
 * @param {string} message
 * @param {(data: Uint8Array) => Promise<ArrayBuffer>} digest SHA-256
 * @returns {Promise<string>} lowercase hex
 */
async function hmacSha256Hex(key, message, digest) {
  const encoder = new TextEncoder();
  let keyBytes = encoder.encode(key);
  if (keyBytes.length > SHA256_BLOCK) keyBytes = new Uint8Array(await digest(keyBytes));
  const block = new Uint8Array(SHA256_BLOCK);
  block.set(keyBytes);
  const inner = new Uint8Array(await digest(concat(block.map((b) => b ^ 0x36), encoder.encode(message))));
  return hex(new Uint8Array(await digest(concat(block.map((b) => b ^ 0x5c), inner))));
}

/** A fresh hex nonce from the runtime's random source. */
function newNonce(getRandomValues) {
  return hex(getRandomValues(new Uint8Array(NONCE_BYTES)));
}

/** The health URL that asks the daemon to prove it holds the token. */
function healthUrl(target, nonce) {
  return `${target.base}/health?nonce=${nonce}`;
}

/**
 * True only when the health answer proves the daemon holds our token
 * (`proof` = HMAC(token, "smr-health:" + nonce)). Anything else on the port fails,
 * and the token is never sent to it.
 */
async function verifyHealth(text, target, nonce, digest) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return false;
  }
  if (body?.service !== 'smart-model-router' || typeof body.proof !== 'string') return false;
  const expected = await hmacSha256Hex(target.token, `smr-health:${nonce}`, digest);
  return constantTimeEqual(body.proof, expected);
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The oldest records first, at most one batch. */
function nextBatch(pending, size = BATCH_SIZE) {
  return Array.isArray(pending) ? pending.slice(0, size) : [];
}

/**
 * What stays buffered after a send. The daemon answers every record it was sent
 * (accepted, duplicate or rejected as invalid) or fails the whole batch, so on success
 * the batch is dropped; on any failure nothing is.
 *
 * @param {unknown[]} pending the buffer as it is now (records may have been added since)
 * @param {unknown[]} batch what was sent
 * @param {{ ok: boolean }} response
 */
function afterSend(pending, batch, response) {
  if (!response?.ok) return pending;
  const ids = new Set(batch.map((record) => record?.decision?.id).filter((id) => id !== undefined));
  const sent = new Set(batch);
  return pending.filter((record) => !sent.has(record) && !ids.has(record?.decision?.id));
}

/** A short description of a failed send, for `/route` status. */
function describeFailure(status) {
  if (status === 401) return 'daemon refused the token (run mr init and update daemonToken)';
  if (status === 413) return 'batch too large for the daemon';
  return `daemon answered ${status}`;
}

module.exports = {
  daemonTarget,
  hmacSha256Hex,
  newNonce,
  healthUrl,
  verifyHealth,
  nextBatch,
  afterSend,
  describeFailure,
  DEFAULT_DAEMON_URL,
  BATCH_SIZE,
};
