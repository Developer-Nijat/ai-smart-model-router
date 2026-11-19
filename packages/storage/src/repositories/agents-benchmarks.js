'use strict';

const { parseColumn } = require('./json');

/**
 * Detected agents (what `mr agents` found) and benchmark runs.
 * @param {import('node:sqlite').DatabaseSync} db
 */
function createAgentRepository(db) {
  const upsert = db.prepare(`INSERT INTO agents (id, display_name, installed, version, capabilities_json, notes_json, detected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET display_name = excluded.display_name, installed = excluded.installed,
        version = excluded.version, capabilities_json = excluded.capabilities_json,
        notes_json = excluded.notes_json, detected_at = excluded.detected_at`);
  const all = db.prepare('SELECT * FROM agents ORDER BY id');

  return Object.freeze({
    /** @param {{ id: string, displayName: string, installed: boolean, version: string | null, capabilities: object, notes: string[], detectedAt: string }} agent */
    save(agent) {
      upsert.run(
        agent.id,
        agent.displayName,
        agent.installed ? 1 : 0,
        agent.version,
        JSON.stringify(agent.capabilities),
        JSON.stringify(agent.notes),
        agent.detectedAt,
      );
    },
    list() {
      return all.all().map((row) => ({
        id: row.id,
        displayName: row.display_name,
        installed: row.installed === 1,
        version: row.version,
        capabilities: parseColumn(row.capabilities_json, {}, `agents.capabilities_json (id=${row.id})`),
        notes: parseColumn(row.notes_json, [], `agents.notes_json (id=${row.id})`),
        detectedAt: row.detected_at,
      }));
    },
  });
}

/** @param {import('node:sqlite').DatabaseSync} db */
function createBenchmarkRepository(db) {
  const insert = db.prepare('INSERT INTO benchmark_runs (id, strategy, started_at, finished_at, summary_json) VALUES (?, ?, ?, ?, ?)');
  const recent = db.prepare('SELECT * FROM benchmark_runs ORDER BY started_at DESC LIMIT ?');
  return Object.freeze({
    /** @param {{ id: string, strategy: string, startedAt: string, finishedAt: string, summary: object }} run */
    save(run) {
      insert.run(run.id, run.strategy, run.startedAt, run.finishedAt, JSON.stringify(run.summary));
    },
    recent(limit = 10) {
      return recent.all(Math.min(Math.max(Math.trunc(limit) || 1, 1), 100)).map((row) => ({
        id: row.id,
        strategy: row.strategy,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        summary: parseColumn(row.summary_json, {}, `benchmark_runs.summary_json (id=${row.id})`),
      }));
    },
  });
}

module.exports = { createAgentRepository, createBenchmarkRepository };
