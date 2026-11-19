'use strict';

const { openStorage, MEMORY } = require('../src');
const { StorageError } = require('@smr/shared');

function turn(overrides = {}) {
  const { decision, ...rest } = overrides;
  return {
    decision: {
      id: 's1:t1',
      sessionId: 's1',
      turnId: 't1',
      agentId: 'claude-code',
      subagentId: null,
      mode: 'auto',
      classification: {
        taskType: 'bug_fix',
        complexity: 0.2,
        reasoning: 'low',
        codingDepth: 'low',
        risk: 'low',
        scope: 'single_file',
        confidence: 0.8,
        latencyPriority: false,
        contextTokens: null,
      },
      selection: { model: 'anthropic.claude-haiku', effort: 'low' },
      alternatives: [],
      reason: 'bug_fix → anthropic.claude-haiku',
      decisionSource: 'classifier-rules',
      status: 'applied',
      appliedModel: 'claude-haiku-5-5',
      appliedEffort: 'low',
      estimatedCostUsd: 0.0012,
      createdAt: '2026-11-19T10:00:00.000Z',
      ...decision,
    },
    verified: true,
    answeredBy: ['claude-haiku-5-5'],
    steps: 2,
    tokens: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 300, cacheWriteTokens: 0 },
    costComplete: true,
    trace: [],
    ...rest,
  };
}

let storage;
beforeEach(() => {
  storage = openStorage(MEMORY);
});
afterEach(() => storage.close());

describe('ingest', () => {
  it('stores a turn with its usage and session', () => {
    expect(storage.records.ingest([turn()])).toEqual({ accepted: 1, duplicates: 0, rejected: [] });
    const [entry] = storage.records.history();
    expect(entry).toMatchObject({
      id: 's1:t1',
      status: 'applied',
      appliedModel: 'claude-haiku-5-5',
      verified: true,
      steps: 2,
      taskType: 'bug_fix',
      tokens: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 300, cacheWriteTokens: 0 },
    });
    const session = storage.db.prepare('SELECT * FROM sessions WHERE id = ?').get('s1');
    expect(session).toMatchObject({ agent_id: 'claude-code', current_model: 'claude-haiku-5-5', routing_mode: 'auto' });
  });

  it('counts a resent record as a duplicate, never twice', () => {
    storage.records.ingest([turn()]);
    expect(storage.records.ingest([turn(), turn({ decision: { id: 's1:t2' } })])).toEqual({ accepted: 1, duplicates: 1, rejected: [] });
    expect(storage.records.summary().total).toBe(2);
    expect(storage.db.prepare('SELECT COUNT(*) AS n FROM usage_records').get().n).toBe(2);
  });

  it('rejects invalid records with a reason and keeps the valid ones', () => {
    const result = storage.records.ingest([
      turn({ decision: { id: 'ok' } }),
      { ...turn({ decision: { id: 'bad' } }), prompt: 'secret words' },
      { nope: true },
    ]);
    expect(result.accepted).toBe(1);
    expect(result.rejected.map((r) => r.index)).toEqual([1, 2]);
    expect(result.rejected[0].reason).toMatch(/prompt/);
    expect(JSON.stringify(storage.records.history())).not.toContain('secret words');
  });

  it('stores no usage row for a turn that reported none, and keeps the session model for subagents', () => {
    storage.records.ingest([turn()]);
    storage.records.ingest([
      turn({ decision: { id: 'sub', subagentId: 'sub', appliedModel: 'claude-opus-5-5' }, answeredBy: ['claude-opus-5-5'] }),
      turn({ decision: { id: 'none', status: 'recommended' }, answeredBy: [], steps: 0, verified: false }),
    ]);
    expect(storage.db.prepare('SELECT COUNT(*) AS n FROM usage_records').get().n).toBe(2);
    expect(storage.db.prepare('SELECT current_model FROM sessions').get().current_model).toBe('claude-haiku-5-5');
    const none = storage.records.history({ limit: 10 }).find((e) => e.id === 'none');
    expect(none).toMatchObject({ tokens: null, verified: false });
  });

  it('rejects free text in id and model fields', () => {
    const result = storage.records.ingest([
      turn({ decision: { id: 'my prompt was about payroll' } }),
      turn({ decision: { id: 'ok2', sessionId: 'x'.repeat(201) } }),
      { ...turn({ decision: { id: 'ok3' } }), answeredBy: ['fix the login bug please'] },
    ]);
    expect(result.accepted).toBe(0);
    expect(result.rejected).toHaveLength(3);
  });

  it('fails the whole batch on a storage error other than a duplicate', () => {
    storage.db.exec('CREATE TRIGGER boom BEFORE INSERT ON usage_records BEGIN SELECT RAISE(ABORT, \'disk full\'); END;');
    expect(() => storage.records.ingest([turn({ decision: { id: 'x1' } })])).toThrow(/cannot store record 0/);
    expect(storage.records.summary().total).toBe(0);
  });

  it('refuses a batch that is not an array or too large', () => {
    expect(() => storage.records.ingest('x')).toThrow(StorageError);
    expect(() => storage.records.ingest(Array.from({ length: 501 }, () => turn()))).toThrow(/at most 500/);
  });
});

describe('history and stats', () => {
  beforeEach(() => {
    storage.records.ingest([
      turn({ decision: { id: 'a', createdAt: '2026-11-01T10:00:00.000Z' } }),
      turn({
        decision: {
          id: 'b',
          sessionId: 's2',
          status: 'recommended',
          mode: 'shadow',
          appliedModel: 'claude-opus-5-5',
          selection: { model: 'anthropic.claude-sonnet', effort: 'medium' },
          estimatedCostUsd: null,
          createdAt: '2026-11-18T10:00:00.000Z',
        },
        answeredBy: ['claude-opus-5-5'],
      }),
      turn({ decision: { id: 'c', subagentId: 'c', createdAt: '2026-11-19T10:00:00.000Z' } }),
    ]);
  });

  it('lists newest first with filters and a clamped limit', () => {
    expect(storage.records.history().map((e) => e.id)).toEqual(['c', 'b', 'a']);
    expect(storage.records.history({ sessionId: 's2' }).map((e) => e.id)).toEqual(['b']);
    expect(storage.records.history({ since: '2026-11-15T00:00:00Z' }).map((e) => e.id)).toEqual(['c', 'b']);
    expect(storage.records.history({ status: 'recommended' }).map((e) => e.id)).toEqual(['b']);
    expect(storage.records.history({ limit: 0 })).toHaveLength(1);
    expect(storage.records.history({ limit: 'x' })).toHaveLength(1);
  });

  it('aggregates counts, tokens and cost, with unknown cost counted apart', () => {
    const stats = storage.records.stats();
    expect(stats).toMatchObject({
      total: 3,
      mainTurns: 2,
      subagentTurns: 1,
      sessions: 2,
      knownCostUsd: 0.0024,
      unknownCostTurns: 1,
      tokens: { input: 3000, output: 600, cacheRead: 900, cacheWrite: 0 },
      byStatus: { applied: 2, recommended: 1 },
      byAnsweredModel: { 'claude-haiku-5-5': 2, 'claude-opus-5-5': 1 },
      byMode: { auto: 2, shadow: 1 },
    });
    expect(storage.records.stats({ since: '2026-11-18T00:00:00Z' }).total).toBe(2);
    expect(storage.records.usage({ since: '2026-11-19T00:00:00Z' })).toEqual([
      expect.objectContaining({ model: 'claude-haiku-5-5', tokens: expect.objectContaining({ inputTokens: 1000 }) }),
    ]);
  });

  it('summarises an empty database', () => {
    const empty = openStorage(MEMORY);
    expect(empty.records.summary()).toEqual({ total: 0, last: null });
    expect(empty.records.stats()).toMatchObject({ total: 0, knownCostUsd: 0, byStatus: {} });
    expect(empty.integrityCheck()).toBe('ok');
    empty.close();
  });
});

describe('agents and benchmarks', () => {
  it('upserts detected agents', () => {
    const base = { id: 'claude-code', displayName: 'Claude Code', capabilities: { turnLevelRouting: true }, notes: [], detectedAt: '2026-11-19T10:00:00.000Z' };
    storage.agents.save({ ...base, installed: false, version: null });
    storage.agents.save({ ...base, installed: true, version: '2.1.328' });
    expect(storage.agents.list()).toEqual([{ ...base, installed: true, version: '2.1.328' }]);
  });

  it('stores benchmark runs newest first', () => {
    const run = (id, startedAt) => ({ id, strategy: 'router', startedAt, finishedAt: startedAt, summary: { accuracy: 0.8 } });
    storage.benchmarks.save(run('r1', '2026-11-18T10:00:00.000Z'));
    storage.benchmarks.save(run('r2', '2026-11-19T10:00:00.000Z'));
    expect(storage.benchmarks.recent().map((r) => r.id)).toEqual(['r2', 'r1']);
    expect(storage.benchmarks.recent(1)[0].summary).toEqual({ accuracy: 0.8 });
  });
});
