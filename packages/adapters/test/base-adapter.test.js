'use strict';

const { BaseAgentAdapter, ok, unsupported, failed } = require('../src');
const { ValidationError } = require('@smr/shared');

describe('BaseAgentAdapter', () => {
  it('validates its definition', () => {
    expect(() => new BaseAgentAdapter()).toThrow(TypeError);
    expect(() => new BaseAgentAdapter({ id: 'Bad Id', displayName: 'x' })).toThrow(TypeError);
    expect(() => new BaseAgentAdapter({ id: 'ok' })).toThrow(/displayName/);
    expect(() => new BaseAgentAdapter({ id: 'ok', displayName: 'Ok', capabilities: { warp: true } })).toThrow(
      ValidationError,
    );
  });

  it('defaults every capability to false and keeps them frozen', () => {
    const adapter = new BaseAgentAdapter({ id: 'bare', displayName: 'Bare' });
    expect(Object.values(adapter.capabilities).every((value) => value === false)).toBe(true);
    expect(() => {
      'use strict';
      adapter.capabilities.turnLevelRouting = true;
    }).toThrow(TypeError);
  });

  it('maps operations to the capabilities they need', () => {
    const startupOnly = new BaseAgentAdapter({
      id: 'startup',
      displayName: 'Startup only',
      capabilities: { startupModelSelection: true },
    });
    expect(startupOnly.supports('applyStartupModel')).toBe(true);
    expect(startupOnly.supports('applyModel')).toBe(false);
    expect(startupOnly.supports('getUsage')).toBe(false);
    expect(startupOnly.supports('teleport')).toBe(false);
  });

  it('answers unsupported with the operation and a reason', async () => {
    const adapter = new BaseAgentAdapter({ id: 'bare', displayName: 'Bare' });
    const result = await adapter.applyModel('anthropic.claude-opus', 'high');
    expect(result).toEqual({
      ok: false,
      status: 'unsupported',
      operation: 'applyModel',
      reason: 'bare cannot switch models during a session',
    });
    expect((await adapter.applyStartupModel('anthropic.claude-opus')).status).toBe('unsupported');
    expect(await adapter.detectInstallation()).toMatchObject({ installed: false, version: null });
  });
});

describe('result helpers', () => {
  it('build frozen results', () => {
    expect(ok(1)).toEqual({ ok: true, status: 'ok', value: 1 });
    expect(failed('applyModel', 'timeout')).toEqual({ ok: false, status: 'failed', operation: 'applyModel', reason: 'timeout' });
    expect(Object.isFrozen(unsupported('x', 'y'))).toBe(true);
  });
});
