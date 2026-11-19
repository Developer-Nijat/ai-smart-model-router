'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { StorageError } = require('@smr/shared');
const { transaction } = require('./database');

// The release bundle ships the .sql files in <root>/migrations (see @smr/config layout).
const RELEASE_ROOT = globalThis.__SMR_RELEASE_ROOT__;
const DEFAULT_DIR = typeof RELEASE_ROOT === 'string' && RELEASE_ROOT ? path.join(RELEASE_ROOT, 'migrations') : path.join(__dirname, 'migrations');
const FILE_PATTERN = /^(\d{3})_([a-z0-9_]+)\.sql$/;

/**
 * Lists migration files in version order.
 * @param {string} [dir]
 * @returns {Array<{ version: number, name: string, sql: string, checksum: string }>}
 */
function listMigrations(dir = DEFAULT_DIR) {
  const files = fs
    .readdirSync(dir)
    .filter((file) => FILE_PATTERN.test(file))
    .sort();

  const migrations = files.map((file) => {
    const [, version, name] = FILE_PATTERN.exec(file);
    const sql = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');
    return {
      version: Number(version),
      name,
      sql,
      checksum: crypto.createHash('sha256').update(sql).digest('hex'),
    };
  });

  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new StorageError(`Migration versions must be contiguous from 001; found ${migration.version} at position ${index + 1}`);
    }
  });
  return migrations;
}

function ensureTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    checksum   TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );`);
}

function readApplied(db) {
  return db.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all();
}

/** Throws unless the applied rows are 1..n, each matching its file, and n is not newer than us. */
function checkApplied(applied, migrations) {
  const latest = migrations.length;
  applied.forEach((row, index) => {
    if (row.version !== index + 1) {
      throw new StorageError(`Applied migrations have a gap at version ${index + 1}; the database is inconsistent.`, {
        version: index + 1,
      });
    }
    if (row.version > latest) {
      throw new StorageError(
        `Database schema version ${applied.length} is newer than this program supports (${latest}). Upgrade Smart Model Router.`,
        { current: applied.length, latest },
      );
    }
    if (migrations[index].checksum !== row.checksum) {
      throw new StorageError(`Applied migration ${row.version} (${row.name}) does not match its file; refusing to continue.`, {
        version: row.version,
      });
    }
  });
  return applied.length;
}

/**
 * Applies every pending migration, each in its own transaction.
 *
 * Safe against several processes starting at once: each migration re-checks, inside
 * its own write lock, whether another process applied it first. Foreign keys are
 * switched off while a migration runs (so a table rebuild cannot cascade-delete rows)
 * and `foreign_key_check` must pass before it commits.
 *
 * Before upgrading a database that already holds data, writes a backup when
 * `backupFile` is given (see openStorage, which gives one by default).
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ dir?: string, backupFile?: (fromVersion: number) => string, now?: () => Date }} [options]
 * @returns {{ from: number, to: number, applied: number[], backup: string | null }}
 */
function migrate(db, options = {}) {
  const migrations = listMigrations(options.dir);
  const now = options.now ?? (() => new Date());
  ensureTable(db);

  const current = checkApplied(readApplied(db), migrations);
  const pending = migrations.slice(current);
  if (pending.length === 0) return { from: current, to: current, applied: [], backup: null };

  const backup = current > 0 && options.backupFile ? writeBackup(db, options.backupFile(current)) : null;
  const applied = [];

  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    for (const migration of pending) {
      if (applyOne(db, migration, now)) applied.push(migration.version);
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }

  return { from: current, to: migrations.length, applied, backup };
}

/** @returns {boolean} false when another process applied it first */
function applyOne(db, migration, now) {
  try {
    return transaction(db, () => {
      const done = db.prepare('SELECT 1 AS done FROM schema_migrations WHERE version = ?').get(migration.version);
      if (done) return false;
      db.exec(migration.sql);
      const violations = db.prepare('PRAGMA foreign_key_check').all();
      if (violations.length > 0) {
        throw new Error(`foreign key check failed in table ${violations[0].table}`);
      }
      db.prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)').run(
        migration.version,
        migration.name,
        migration.checksum,
        now().toISOString(),
      );
      return true;
    });
  } catch (error) {
    throw new StorageError(`Migration ${migration.version} (${migration.name}) failed: ${error.message}`, {
      version: migration.version,
    });
  }
}

/**
 * Copies the database with `VACUUM INTO` to a temp name, checks the copy, then renames it.
 * A failure leaves no partial file behind and blocks the upgrade with a clear error.
 */
function writeBackup(db, file) {
  if (fs.existsSync(file)) throw new StorageError(`Backup file already exists: ${file}`, { file });
  const temp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    db.prepare('VACUUM INTO ?').run(temp);
    verifyBackup(temp);
    fs.renameSync(temp, file);
    return file;
  } catch (error) {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // No temp file to remove (on Linux a missing parent folder is ENOTDIR, not ENOENT).
    }
    throw new StorageError(`Backup before upgrade failed, database left unchanged: ${error.message}`, { file });
  }
}

function verifyBackup(file) {
  const copy = new DatabaseSync(file, { readOnly: true });
  try {
    const result = copy.prepare('PRAGMA integrity_check').get();
    if (result.integrity_check !== 'ok') throw new Error(`integrity check: ${result.integrity_check}`);
  } finally {
    copy.close();
  }
}

module.exports = { migrate, listMigrations, DEFAULT_DIR };
