'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { StorageError } = require('@smr/shared');

const MEMORY = ':memory:';

/**
 * Opens (creating if needed) a SQLite database with safe defaults:
 * WAL for file databases, foreign keys on, a busy timeout for concurrent sessions.
 * A failure after opening closes the handle, so no file stays locked (Windows).
 *
 * @param {string} file absolute path, or ':memory:'
 * @returns {import('node:sqlite').DatabaseSync}
 */
function openDatabase(file) {
  if (typeof file !== 'string' || file.length === 0) {
    throw new StorageError('Database path must be a non-empty string');
  }
  let db;
  try {
    if (file !== MEMORY) fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new DatabaseSync(file);
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec('PRAGMA foreign_keys = ON;');
    if (file !== MEMORY) db.exec('PRAGMA journal_mode = WAL;');
    return db;
  } catch (error) {
    if (db) closeQuietly(db);
    throw new StorageError(`Cannot open database ${file}: ${error.message}`, { file });
  }
}

function closeQuietly(db) {
  try {
    db.close();
  } catch {
    // Already closed or never usable: nothing more to release.
  }
}

/**
 * Runs `work` inside a write transaction; rolls back and rethrows the ORIGINAL error.
 * @template T
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {() => T} work
 * @returns {T}
 */
function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = work();
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // The transaction may already be gone; the original error is what matters.
    }
    throw error;
  }
}

module.exports = { openDatabase, transaction, closeQuietly, MEMORY };
