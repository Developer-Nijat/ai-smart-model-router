'use strict';

const { openDatabase, transaction, closeQuietly, MEMORY } = require('./database');
const { migrate, listMigrations } = require('./migrate');
const { createDecisionRepository } = require('./repositories/decisions');
const { createSettingsRepository } = require('./repositories/settings');
const { createRecordRepository } = require('./repositories/records');
const { createAgentRepository, createBenchmarkRepository } = require('./repositories/agents-benchmarks');

/**
 * Where the pre-upgrade backup of `file` goes: next to it, unique per run.
 * @param {string} file
 * @param {() => Date} now
 */
function defaultBackupFile(file, now) {
  return (fromVersion) => `${file}.bak-v${fromVersion}-${now().toISOString().replace(/[:.]/g, '-')}`;
}

/**
 * Opens the database, brings its schema up to date and returns the repositories.
 * A file database that already holds data is backed up before any upgrade, unless
 * the caller passes its own `backupFile` (or `backupFile: null` to skip, e.g. in tests).
 *
 * @param {string} file
 * @param {{
 *   dir?: string,
 *   backupFile?: ((fromVersion: number) => string) | null,
 *   now?: () => Date,
 *   settingsSchemas?: Record<string, import('zod').ZodType>,
 * }} [options]
 */
function openStorage(file, options = {}) {
  const now = options.now ?? (() => new Date());
  const backupFile =
    options.backupFile === undefined && file !== MEMORY ? defaultBackupFile(file, now) : options.backupFile ?? undefined;
  const db = openDatabase(file);
  try {
    const migration = migrate(db, { ...options, now, backupFile });
    return Object.freeze({
      db,
      migration,
      decisions: createDecisionRepository(db),
      settings: createSettingsRepository(db, { now, schemas: options.settingsSchemas }),
      records: createRecordRepository(db),
      agents: createAgentRepository(db),
      benchmarks: createBenchmarkRepository(db),
      /** `ok`, or the first problem SQLite reports. */
      integrityCheck: () => db.prepare('PRAGMA integrity_check').get().integrity_check,
      close: () => db.close(),
    });
  } catch (error) {
    closeQuietly(db);
    throw error;
  }
}

module.exports = {
  openStorage,
  openDatabase,
  transaction,
  migrate,
  listMigrations,
  createDecisionRepository,
  createSettingsRepository,
  createRecordRepository,
  createAgentRepository,
  createBenchmarkRepository,
  MEMORY,
};
