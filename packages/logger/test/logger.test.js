'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLogger, createFileSink, stderrSink, redact, REDACTED, OMITTED } = require('../src');

const FIXED = () => new Date('2026-11-18T10:00:00.000Z');

function capture(options = {}) {
  const lines = [];
  const logger = createLogger({ now: FIXED, sinks: [(line) => lines.push(JSON.parse(line))], ...options });
  return { logger, lines };
}

describe('redact', () => {
  it('redacts secret keys and omits user content keys', () => {
    const out = redact({ apiKey: 'abc', nested: { Authorization: 'x', prompt: 'my secret plan', model: 'opus' } });
    expect(out).toEqual({ apiKey: REDACTED, nested: { Authorization: REDACTED, prompt: OMITTED, model: 'opus' } });
  });

  it('redacts credential shapes inside free text', () => {
    const text = 'key sk-ant-api03-abcdefghijkl and Bearer abc.def.ghijk and AIzaSyA1234567890123456789012';
    const out = redact(text);
    expect(out).not.toMatch(/sk-ant|abc\.def|AIza/);
    expect(out.match(/\[REDACTED\]/g)).toHaveLength(3);
  });

  it('does not mutate its input', () => {
    const input = Object.freeze({ token: 't', list: Object.freeze(['sk-proj-abcdefghijklmnopqrstu']) });
    const out = redact(input);
    expect(input.token).toBe('t');
    expect(out.list[0]).toBe(REDACTED);
  });

  it('cuts cycles and deep nesting', () => {
    const cyclic = { a: 1 };
    cyclic.self = cyclic;
    expect(redact(cyclic).self).toBe('[Circular]');

    let deep = { leaf: true };
    for (let i = 0; i < 12; i += 1) deep = { deep };
    expect(JSON.stringify(redact(deep))).toContain('[Truncated]');
  });

  it('reduces errors to name, message and code', () => {
    const error = Object.assign(new Error('bad sk-ant-api03-abcdefghijkl'), { code: 'E_X' });
    expect(redact(error)).toEqual({ name: 'Error', message: `bad ${REDACTED}`, code: 'E_X' });
    expect(redact(new TypeError('t'))).toEqual({ name: 'TypeError', message: 't' });
  });

  it('omits prompt-like keys in any spelling', () => {
    const out = redact({ userPrompt: 'a', system_prompt: 'b', message: 'c', 'prompt-text': 'd', diff: 'e', stdout: 'f' });
    expect(Object.values(out).every((value) => value === OMITTED)).toBe(true);
  });

  it('keeps counts and harmless keys that merely look similar', () => {
    const out = redact({
      maxTokens: 4096,
      inputTokens: 10,
      outputTokens: 3,
      contextTokens: 72000,
      context: { utilization: 0.4 },
      cacheKey: 'abc',
      hasPassword: true,
    });
    expect(out).toEqual({
      maxTokens: 4096,
      inputTokens: 10,
      outputTokens: 3,
      contextTokens: 72000,
      context: { utilization: 0.4 },
      cacheKey: 'abc',
      hasPassword: true,
    });
  });

  it('redacts qualified keys and secret objects', () => {
    const out = redact({ api_key: 'x', privateKey: 'y', refreshTokens: ['a'], credentials: { user: 'u' } });
    expect(Object.values(out).every((value) => value === REDACTED)).toBe(true);
  });

  it('redacts more credential shapes in free text', () => {
    const text = [
      'AKIAABCDEFGHIJKLMNOP',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJlMTIz',
      'xoxb-1234567890-abcdef',
      'github_pat_11ABCDEFG0123456789_abcdefghij',
      'https://user:hunter2@example.com/x',
      'curl ?api_key=abc123&x=1 password=letmein',
    ].join(' ');
    const out = redact(text);
    for (const leaked of ['AKIAABCD', 'eyJhbGci', 'xoxb-', 'github_pat_', 'hunter2', 'abc123', 'letmein']) {
      expect(out).not.toContain(leaked);
    }
    expect(out).toContain(`https://${REDACTED}@example.com/x`);
  });

  it('converts values JSON cannot hold', () => {
    const out = redact({
      big: 10n,
      fn: () => 1,
      sym: Symbol('s'),
      when: new Date('2026-11-18T10:00:00Z'),
      bad: new Date('nope'),
      map: new Map([['model', 'opus']]),
      set: new Set(['a']),
    });
    expect(out).toEqual({
      big: '10',
      fn: '[Function]',
      sym: 'Symbol(s)',
      when: '2026-11-18T10:00:00.000Z',
      bad: 'Invalid Date',
      map: { model: 'opus' },
      set: ['a'],
    });
  });

  it('keeps an object referenced twice as siblings (not a cycle)', () => {
    const shared = { model: 'opus' };
    expect(redact({ a: shared, b: shared })).toEqual({ a: { model: 'opus' }, b: { model: 'opus' } });
  });

  it('survives a throwing getter', () => {
    const hostile = {
      get boom() {
        throw new Error('no');
      },
    };
    expect(redact({ hostile })).toEqual({ hostile: '[Unserializable]' });
  });

  it('passes primitives through', () => {
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });
});

describe('createLogger', () => {
  it('writes JSON lines with timestamp, level, message and fields', () => {
    const { logger, lines } = capture();
    logger.info('decision made', { model: 'sonnet' });
    expect(lines).toEqual([{ ts: '2026-11-18T10:00:00.000Z', level: 'info', msg: 'decision made', model: 'sonnet' }]);
  });

  it('drops entries below the configured level', () => {
    const { logger, lines } = capture({ level: 'warn' });
    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');
    expect(lines.map((line) => line.level)).toEqual(['warn', 'error']);
  });

  it('redacts fields before writing', () => {
    const { logger, lines } = capture();
    logger.error('failed', { apiKey: 'sk-ant-api03-abcdefghijkl', prompt: 'hidden' });
    expect(lines[0].apiKey).toBe(REDACTED);
    expect(lines[0].prompt).toBe(OMITTED);
  });

  it('redacts secrets inside the message itself', () => {
    const { logger, lines } = capture();
    logger.error('auth failed with sk-ant-api03-abcdefghijkl');
    expect(lines[0].msg).toBe(`auth failed with ${REDACTED}`);
  });

  it('never lets fields overwrite ts, level or msg', () => {
    const { logger, lines } = capture({ bindings: { level: 'bound' } });
    logger.info('real', { level: 'error', msg: 'spoof', ts: 'never' });
    logger.child({ msg: 'child spoof' }).warn('real child');
    expect(lines[0]).toEqual({ ts: '2026-11-18T10:00:00.000Z', level: 'info', msg: 'real' });
    expect(lines[1]).toMatchObject({ level: 'warn', msg: 'real child' });
  });

  it('never throws into the caller', () => {
    const { logger, lines } = capture();
    expect(() => logger.info('big', { n: 10n })).not.toThrow();
    expect(lines[0].n).toBe('10');
    expect(() => logger.info('odd fields', 'not an object')).not.toThrow();
    const broken = createLogger({
      sinks: [(line) => lines.push(JSON.parse(line))],
      now: () => {
        throw new Error('clock broke');
      },
    });
    expect(() => broken.warn('x')).not.toThrow();
    expect(lines.at(-1).msg).toBe('[log entry could not be serialized]');
  });

  it('child loggers add bindings without changing the parent', () => {
    const { logger, lines } = capture({ bindings: { app: 'smr' } });
    const child = logger.child({ sessionId: 's-1' });
    child.info('x');
    logger.info('y');
    expect(lines[0]).toMatchObject({ app: 'smr', sessionId: 's-1' });
    expect(lines[1].sessionId).toBeUndefined();
  });

  it('survives a sink that throws', () => {
    const good = [];
    const logger = createLogger({
      sinks: [
        () => {
          throw new Error('disk full');
        },
        (line) => good.push(line),
      ],
    });
    expect(() => logger.info('still works')).not.toThrow();
    expect(good).toHaveLength(1);
  });

  it('rejects an unknown level', () => {
    expect(() => createLogger({ level: 'verbose' })).toThrow(TypeError);
  });

  it('writes to stderr by default', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      createLogger().warn('to stderr');
      stderrSink('raw');
      expect(spy).toHaveBeenCalledTimes(2);
      expect(String(spy.mock.calls[0][0])).toMatch(/"msg":"to stderr"/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('createFileSink', () => {
  it('creates the folder and appends lines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-log-'));
    try {
      const file = path.join(dir, 'logs', 'smr.log');
      const logger = createLogger({ sinks: [createFileSink(file)], now: FIXED });
      logger.info('one');
      logger.info('two');
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
      expect(lines.map((line) => JSON.parse(line).msg)).toEqual(['one', 'two']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
