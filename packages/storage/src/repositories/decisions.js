'use strict';

const { RoutingDecisionSchema, parseOrThrow, StorageError } = require('@smr/shared');
const { parseColumn, isUniqueViolation } = require('./json');

const MAX_LIMIT = 500;

function rowToDecision(row) {
  const where = (column) => `routing_decisions.${column} (id=${row.id})`;
  return {
    id: row.id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    agentId: row.agent_id,
    subagentId: row.subagent_id,
    mode: row.mode,
    classification: parseColumn(row.classification_json, null, where('classification_json')),
    selection: { model: row.selected_model, effort: row.selected_effort },
    alternatives: parseColumn(row.alternatives_json, [], where('alternatives_json')),
    reason: row.reason,
    decisionSource: row.decision_source,
    status: row.status,
    appliedModel: row.applied_model,
    appliedEffort: row.applied_effort,
    estimatedCostUsd: row.estimated_cost_usd,
    createdAt: row.created_at,
  };
}

/**
 * Routing decisions: validated on the way in, every query parameterised.
 * `createdAt` is stored normalised (`toISOString`, millisecond precision, UTC) so
 * that ordering by the text column is ordering by time.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 */
function createDecisionRepository(db) {
  const insertStmt = db.prepare(`INSERT INTO routing_decisions (
      id, session_id, turn_id, agent_id, subagent_id, mode, task_type, classification_json,
      selected_model, selected_effort, alternatives_json, reason, decision_source, status,
      applied_model, applied_effort, estimated_cost_usd, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const byIdStmt = db.prepare('SELECT * FROM routing_decisions WHERE id = ?');
  const recentStmt = db.prepare('SELECT * FROM routing_decisions ORDER BY created_at DESC, id DESC LIMIT ?');
  const recentBySessionStmt = db.prepare(
    'SELECT * FROM routing_decisions WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
  );

  return Object.freeze({
    /** @returns the decision as stored (defaults filled in, createdAt normalised) */
    insert(input) {
      const parsed = parseOrThrow(RoutingDecisionSchema, input, 'routing decision');
      const d = { ...parsed, createdAt: new Date(parsed.createdAt).toISOString() };
      try {
        insertStmt.run(
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
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new StorageError(`A routing decision with id ${d.id} already exists`, { id: d.id, code: 'DUPLICATE' });
        }
        throw new StorageError(`Cannot store routing decision ${d.id}: ${error.message}`, { id: d.id });
      }
      return d;
    },

    findById(id) {
      const row = byIdStmt.get(id);
      return row ? rowToDecision(row) : null;
    },

    /** Newest first. `limit` is clamped to 1..500. */
    listRecent({ limit = 50, sessionId } = {}) {
      const bounded = Math.min(Math.max(Math.trunc(Number(limit)) || 1, 1), MAX_LIMIT);
      const rows = sessionId ? recentBySessionStmt.all(sessionId, bounded) : recentStmt.all(bounded);
      return rows.map(rowToDecision);
    },
  });
}

module.exports = { createDecisionRepository, MAX_LIMIT };
