'use strict';

const { TurnRecordSchema, MAX_RECORDS_PER_BATCH, formatIssues, StorageError } = require('@smr/shared');
const { transaction } = require('../database');
const { parseColumn, isUniqueViolation } = require('./json');

const MAX_HISTORY = 500;
const MAX_REJECT_REASON = 300;

/**
 * Turn records from agent integrations: ingest (idempotent by decision id) and the
 * read side the CLI and dashboard use. Every query is parameterised.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 */
function createRecordRepository(db) {
  // Prepared on first use: a database opened with older migrations (tests, a failed
  // upgrade) can still open; only ingesting needs the 002 columns.
  const lazy = (sql) => {
    let stmt = null;
    return () => (stmt ??= db.prepare(sql));
  };
  const insertDecision = lazy(`INSERT INTO routing_decisions (
      id, session_id, turn_id, agent_id, subagent_id, mode, task_type, classification_json,
      selected_model, selected_effort, alternatives_json, reason, decision_source, status,
      applied_model, applied_effort, estimated_cost_usd, created_at, verified, steps
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertUsage = lazy(`INSERT INTO usage_records (
      decision_id, session_id, agent_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const upsertSession = lazy(`INSERT INTO sessions (id, agent_id, started_at, current_model, routing_mode)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        current_model = COALESCE(excluded.current_model, sessions.current_model),
        routing_mode = excluded.routing_mode,
        started_at = MIN(sessions.started_at, excluded.started_at)`);

  function store(record) {
    const d = { ...record.decision, createdAt: new Date(record.decision.createdAt).toISOString() };
    insertDecision().run(
      d.id,
      d.sessionId,
      d.turnId,
      d.agentId,
      d.subagentId,
      d.mode,
      d.classification ? d.classification.taskType : null,
      d.classification ? JSON.stringify(d.classification) : null,
      d.selection.model,
      d.selection.effort,
      JSON.stringify(d.alternatives),
      d.reason,
      d.decisionSource,
      d.status,
      d.appliedModel,
      d.appliedEffort,
      d.estimatedCostUsd,
      d.createdAt,
      record.verified ? 1 : 0,
      record.steps,
    );
    const answered = record.answeredBy.at(-1);
    if (record.steps > 0 && answered) {
      const t = record.tokens;
      insertUsage().run(d.id, d.sessionId, d.agentId, answered, t.inputTokens, t.outputTokens, t.cacheReadTokens, t.cacheWriteTokens, d.createdAt);
    }
    // A subagent's model is not the session's model.
    upsertSession().run(d.sessionId, d.agentId, d.createdAt, d.subagentId ? null : answered ?? null, d.mode);
  }

  return Object.freeze({
    /**
     * Stores a batch in one transaction. A record seen before (same decision id) counts as
     * a duplicate, so an integration may resend safely; an invalid one is rejected with
     * the reason and does not stop the rest. Any other storage failure (disk full, locked
     * database) fails the whole batch, so the sender keeps it and tries again later.
     *
     * @param {unknown[]} records
     * @returns {{ accepted: number, duplicates: number, rejected: { index: number, reason: string }[] }}
     */
    ingest(records) {
      if (!Array.isArray(records)) throw new StorageError('records must be an array');
      if (records.length > MAX_RECORDS_PER_BATCH) throw new StorageError(`at most ${MAX_RECORDS_PER_BATCH} records per batch`);
      const result = { accepted: 0, duplicates: 0, rejected: [] };
      transaction(db, () => {
        records.forEach((raw, index) => {
          const parsed = TurnRecordSchema.safeParse(raw);
          if (!parsed.success) {
            result.rejected.push({ index, reason: formatIssues(parsed.error).join('; ').slice(0, MAX_REJECT_REASON) });
            return;
          }
          db.exec('SAVEPOINT record;');
          try {
            store(parsed.data);
            db.exec('RELEASE record;');
            result.accepted += 1;
          } catch (error) {
            db.exec('ROLLBACK TO record; RELEASE record;');
            if (!isUniqueViolation(error)) throw new StorageError(`cannot store record ${index}: ${error.message}`, { index });
            result.duplicates += 1;
          }
        });
      });
      return result;
    },

    /**
     * Newest first, with the reported tokens.
     * @param {{ limit?: number, sessionId?: string, since?: string | null, status?: string }} [filter]
     */
    history(filter = {}) {
      const limit = Math.min(Math.max(Math.trunc(Number(filter.limit ?? 20)) || 1, 1), MAX_HISTORY);
      const { where, params } = conditions(filter);
      const rows = db
        .prepare(
          `SELECT d.*, u.model AS usage_model, u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_write_tokens
           FROM routing_decisions d LEFT JOIN usage_records u ON u.decision_id = d.id
           ${where} ORDER BY d.created_at DESC, d.id DESC LIMIT ?`,
        )
        .all(...params, limit);
      return rows.map(rowToEntry);
    },

    /**
     * Aggregates for a period.
     * @param {{ since?: string | null }} [filter]
     */
    stats(filter = {}) {
      const { where, params } = conditions(filter);
      const group = (column) =>
        Object.fromEntries(
          db
            .prepare(`SELECT ${column} AS k, COUNT(*) AS n FROM routing_decisions d ${where} GROUP BY ${column} ORDER BY n DESC, k`)
            .all(...params)
            .map((row) => [row.k ?? 'unknown', row.n]),
        );
      const totals = db
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN d.subagent_id IS NULL THEN 0 ELSE 1 END) AS subagent,
                  SUM(CASE WHEN d.estimated_cost_usd IS NULL THEN 0 ELSE d.estimated_cost_usd END) AS cost,
                  SUM(CASE WHEN d.estimated_cost_usd IS NULL AND d.status <> 'skipped' THEN 1 ELSE 0 END) AS unknown_cost,
                  COUNT(DISTINCT d.session_id) AS sessions,
                  MIN(d.created_at) AS first, MAX(d.created_at) AS last
           FROM routing_decisions d ${where}`,
        )
        .get(...params);
      const tokens = db
        .prepare(
          `SELECT COALESCE(SUM(u.input_tokens), 0) AS input, COALESCE(SUM(u.output_tokens), 0) AS output,
                  COALESCE(SUM(u.cache_read_tokens), 0) AS cache_read, COALESCE(SUM(u.cache_write_tokens), 0) AS cache_write
           FROM usage_records u JOIN routing_decisions d ON d.id = u.decision_id ${where}`,
        )
        .get(...params);
      return {
        total: totals.total,
        mainTurns: totals.total - (totals.subagent ?? 0),
        subagentTurns: totals.subagent ?? 0,
        sessions: totals.sessions,
        first: totals.first,
        last: totals.last,
        knownCostUsd: Math.round((totals.cost ?? 0) * 1e6) / 1e6,
        unknownCostTurns: totals.unknown_cost ?? 0,
        tokens: { input: tokens.input, output: tokens.output, cacheRead: tokens.cache_read, cacheWrite: tokens.cache_write },
        byStatus: group('d.status'),
        byAnsweredModel: group('d.applied_model'),
        bySelectedModel: group('d.selected_model'),
        bySource: group('d.decision_source'),
        byTaskType: group('d.task_type'),
        byMode: group('d.mode'),
      };
    },

    /**
     * Reported usage per turn for a period, for cost comparisons.
     * @param {{ since?: string | null }} [filter]
     */
    usage(filter = {}) {
      const { where, params } = conditions(filter);
      return db
        .prepare(
          `SELECT u.model, u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_write_tokens, u.recorded_at
           FROM usage_records u JOIN routing_decisions d ON d.id = u.decision_id ${where}`,
        )
        .all(...params)
        .map((row) => ({
          model: row.model,
          recordedAt: row.recorded_at,
          tokens: {
            inputTokens: row.input_tokens,
            outputTokens: row.output_tokens,
            cacheReadTokens: row.cache_read_tokens,
            cacheWriteTokens: row.cache_write_tokens,
          },
        }));
    },

    /** Count and newest time, for `mr status`. */
    summary() {
      const row = db.prepare('SELECT COUNT(*) AS total, MAX(created_at) AS last FROM routing_decisions').get();
      return { total: row.total, last: row.last };
    },
  });
}

function conditions(filter) {
  const parts = [];
  const params = [];
  if (filter.since) {
    parts.push('d.created_at >= ?');
    params.push(new Date(filter.since).toISOString());
  }
  if (filter.sessionId) {
    parts.push('d.session_id = ?');
    params.push(filter.sessionId);
  }
  if (filter.status) {
    parts.push('d.status = ?');
    params.push(filter.status);
  }
  return { where: parts.length > 0 ? `WHERE ${parts.join(' AND ')}` : '', params };
}

function rowToEntry(row) {
  const where = (column) => `routing_decisions.${column} (id=${row.id})`;
  return {
    id: row.id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    subagentId: row.subagent_id,
    mode: row.mode,
    taskType: row.task_type,
    classification: parseColumn(row.classification_json, null, where('classification_json')),
    selection: { model: row.selected_model, effort: row.selected_effort },
    reason: row.reason,
    decisionSource: row.decision_source,
    status: row.status,
    appliedModel: row.applied_model,
    appliedEffort: row.applied_effort,
    estimatedCostUsd: row.estimated_cost_usd,
    verified: row.verified === null ? null : row.verified === 1,
    steps: row.steps,
    createdAt: row.created_at,
    tokens: row.usage_model
      ? {
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          cacheReadTokens: row.cache_read_tokens,
          cacheWriteTokens: row.cache_write_tokens,
        }
      : null,
  };
}

module.exports = { createRecordRepository, MAX_HISTORY };
