'use strict';

const crypto = require('node:crypto');
const { daemonTarget, nextBatch, afterSend, BATCH_SIZE, hmacSha256Hex, newNonce, healthUrl, verifyHealth, describeFailure } = require('../src');

const digest = (data) => crypto.subtle.digest('SHA-256', data);

const TOKEN = 'a'.repeat(64);

describe('daemonTarget', () => {
  it('defaults to the loopback daemon when a token is set', () => {
    expect(daemonTarget({ daemonToken: TOKEN })).toEqual({ base: 'http://127.0.0.1:4747', endpoint: 'http://127.0.0.1:4747/v1/records', token: TOKEN });
    expect(daemonTarget({ daemonToken: ` ${TOKEN} `, daemonUrl: 'http://localhost:3101/' }).endpoint).toBe('http://localhost:3101/v1/records');
    expect(daemonTarget({ daemonToken: TOKEN, daemonUrl: 'http://[::1]:4747' }).endpoint).toBe('http://[::1]:4747/v1/records');
  });

  it('buffers only without a valid token', () => {
    expect(daemonTarget({})).toEqual({ disabled: 'no daemon token set (run mr init)' });
    expect(daemonTarget({ daemonToken: 'xyz' }).disabled).toMatch(/malformed/);
  });

  it.each(['https://127.0.0.1:4747', 'http://example.com:4747', 'http://10.0.0.5:4747', 'http://user:pw@127.0.0.1:4747', 'not a url'])(
    'never sends off the machine: %s',
    (daemonUrl) => {
      expect(daemonTarget({ daemonToken: TOKEN, daemonUrl })).toHaveProperty('disabled');
    },
  );
});

describe('batching', () => {
  const rec = (id) => ({ decision: { id } });

  it('takes the oldest records, at most one batch', () => {
    const pending = Array.from({ length: BATCH_SIZE + 5 }, (_, i) => rec(`r${i}`));
    expect(nextBatch(pending)).toHaveLength(BATCH_SIZE);
    expect(nextBatch(pending, 2).map((r) => r.decision.id)).toEqual(['r0', 'r1']);
    expect(nextBatch(undefined)).toEqual([]);
  });

  it('drops the sent batch on success, keeps everything on failure, keeps records added meanwhile', () => {
    const batch = [rec('a'), rec('b')];
    const now = [rec('a'), rec('b'), rec('c')];
    expect(afterSend(now, batch, { ok: true }).map((r) => r.decision.id)).toEqual(['c']);
    expect(afterSend(now, batch, { ok: false })).toBe(now);
    expect(afterSend(now, batch, undefined)).toBe(now);
  });
});

describe('daemon identity', () => {
  it('computes HMAC-SHA256 exactly as Node does, for short and long keys', async () => {
    for (const key of [TOKEN, 'k', 'x'.repeat(100)]) {
      const expected = crypto.createHmac('sha256', key).update('smr-health:abc').digest('hex');
      expect(await hmacSha256Hex(key, 'smr-health:abc', digest)).toBe(expected);
    }
  });

  it('accepts only a proof made with our token', async () => {
    const target = daemonTarget({ daemonToken: TOKEN });
    const nonce = newNonce((bytes) => crypto.getRandomValues(bytes));
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(healthUrl(target, nonce)).toBe(`http://127.0.0.1:4747/health?nonce=${nonce}`);
    const proof = crypto.createHmac('sha256', TOKEN).update(`smr-health:${nonce}`).digest('hex');
    const body = (extra) => JSON.stringify({ service: 'smart-model-router', ...extra });
    expect(await verifyHealth(body({ proof }), target, nonce, digest)).toBe(true);
    expect(await verifyHealth(body({ proof: 'f'.repeat(64) }), target, nonce, digest)).toBe(false);
    expect(await verifyHealth(body({ proof: 'short' }), target, nonce, digest)).toBe(false);
    expect(await verifyHealth(body({}), target, nonce, digest)).toBe(false);
    expect(await verifyHealth(JSON.stringify({ service: 'other', proof }), target, nonce, digest)).toBe(false);
    expect(await verifyHealth('not json', target, nonce, digest)).toBe(false);
  });

  it('describes failed sends', () => {
    expect(describeFailure(401)).toMatch(/token/);
    expect(describeFailure(413)).toMatch(/too large/);
    expect(describeFailure(500)).toBe('daemon answered 500');
  });
});
