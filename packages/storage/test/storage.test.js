'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  openStorage,
  openDatabase,
  transaction,
  migrate,
  listMigrations,
  createDecisionRepository,
  createSettingsRepository,
  MEMORY,
} = require('../src');
const { DEFAULT_DIR } = require('../src/migrate');

const SHIPPED = listMigrations().map((m) => m.version);
const LATEST = SHIPPED.length;
const { StorageError, ValidationError } = require('@smr/shared');
const { z } = require('zod');

const SETTINGS_SCHEMAS = { 'dashboard.token-hash': z.object({ v: z.number().int() }), ok: z.boolean(), blob: z.string() };

const EXPECTED_TABLES = [
  'agents',
  'benchmark_runs',
  'model_pricing',
  'models',
  'providers',
  'routing_decisions',
  'routing_rules',
  'schema_migrations',
  'sessions',
  'settings',
  'usage_records',
];

function tables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);
}

function decision(overrides = {}) {
  return {
    id: 'd-1',
    sessionId: 's-1',
    agentId: 'claude-code',
    mode: 'shadow',
    selection: { model: 'anthropic.claude-sonnet', effort: 'medium' },
    reason: 'no rule matched',
    decisionSource: 'default',
    status: 'recommended',
    createdAt: '2026-11-18T09:00:00.000Z',
    ...overrides,
  };
}

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-storage-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A migrations folder holding the real 001 plus any extra files. */
/** A migrations folder: 001 only (or every shipped one with `all`), plus `extra` files. */
function migrationsDir(extra = {}, { all = false } = {}) {
  const dir = path.join(tmp, `migrations-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir);
  const shipped = all ? fs.readdirSync(DEFAULT_DIR).filter((f) => f.endsWith('.sql')) : ['001_initial.sql'];
  for (const name of shipped) fs.copyFileSync(path.join(DEFAULT_DIR, name), path.join(dir, name));
  for (const [name, sql] of Object.entries(extra)) fs.writeFileSync(path.join(dir, name), sql);
  return dir;
}

describe('openDatabase', () => {
  it('enables foreign keys and WAL for file databases', () => {
    const db = openDatabase(path.join(tmp, 'deep', 'smr.db'));
    expect(db.prepare('PRAGMA foreign_keys').get().foreign_keys).toBe(1);
    expect(db.prepare('PRAGMA journal_mode').get().journal_mode).toBe('wal');
    db.close();
  });

  it('rejects an empty path and wraps open failures', () => {
    expect(() => openDatabase('')).toThrow(StorageError);
    fs.mkdirSync(path.join(tmp, 'is-a-dir.db'));
    expect(() => openDatabase(path.join(tmp, 'is-a-dir.db'))).toThrow(/Cannot open database/);
  });
});

describe('transaction', () => {
  it('rolls back on error', () => {
    const db = openDatabase(MEMORY);
    db.exec('CREATE TABLE t (x INTEGER)');
    expect(() =>
      transaction(db, () => {
        db.prepare('INSERT INTO t VALUES (1)').run();
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.prepare('SELECT COUNT(*) AS n FROM t').get().n).toBe(0);
    expect(transaction(db, () => 'ok')).toBe('ok');
    db.close();
  });
});

describe('migrate', () => {
  it('creates every MVP table on an empty database', () => {
    const db = openDatabase(MEMORY);
    const result = migrate(db);
    expect(result).toEqual({ from: 0, to: LATEST, applied: SHIPPED, backup: null });
    expect(tables(db)).toEqual(EXPECTED_TABLES);
    db.close();
  });

  it('stores no prompt text column anywhere', () => {
    const db = openDatabase(MEMORY);
    migrate(db);
    const columns = tables(db).flatMap((table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    expect(columns.filter((name) => /prompt|message|content/i.test(name))).toEqual([]);
    db.close();
  });

  it('is idempotent', () => {
    const db = openDatabase(MEMORY);
    migrate(db);
    expect(migrate(db)).toEqual({ from: LATEST, to: LATEST, applied: [], backup: null });
    db.close();
  });

  it('upgrades an existing database, keeps its data and writes a backup first', () => {
    const file = path.join(tmp, 'smr.db');
    const v1 = openStorage(file, { dir: migrationsDir() });
    v1.decisions.insert(decision());
    v1.close();

    const dir = migrationsDir({ '002_add_note.sql': 'ALTER TABLE routing_decisions ADD COLUMN note TEXT;' });
    const db = openDatabase(file);
    const result = migrate(db, { dir, backupFile: (from) => path.join(tmp, `smr.db.bak-${from}`) });
    expect(result.applied).toEqual([2]);
    expect(result.backup).toBe(path.join(tmp, 'smr.db.bak-1'));
    expect(fs.existsSync(result.backup)).toBe(true);
    expect(createDecisionRepository(db).findById('d-1').reason).toBe('no rule matched');
    db.close();

    const backup = openDatabase(result.backup);
    expect(backup.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v).toBe(1);
    backup.close();
  });

  it('backs up by default in openStorage before upgrading a file database', () => {
    const file = path.join(tmp, 'smr.db');
    openStorage(file, { dir: migrationsDir() }).close();
    const storage = openStorage(file, {
      dir: migrationsDir({ '002_x.sql': 'SELECT 1;' }),
      now: () => new Date('2026-11-18T10:00:00.000Z'),
    });
    expect(storage.migration.backup).toBe(`${file}.bak-v1-2026-11-18T10-00-00-000Z`);
    expect(fs.existsSync(storage.migration.backup)).toBe(true);
    storage.close();
  });

  it('skips the backup for a fresh database and when told to', () => {
    const file = path.join(tmp, 'smr.db');
    const fresh = openStorage(file, { dir: migrationsDir() });
    expect(fresh.migration.backup).toBeNull();
    fresh.close();
    const again = openStorage(file, { dir: migrationsDir({ '002_x.sql': 'SELECT 1;' }), backupFile: null });
    expect(again.migration.backup).toBeNull();
    again.close();
  });

  it('leaves no partial file and no upgrade when the backup fails', () => {
    const file = path.join(tmp, 'smr.db');
    openStorage(file, { dir: migrationsDir(), backupFile: null }).close();
    const target = path.join(tmp, 'no-such-dir-file', 'x.bak');
    fs.writeFileSync(path.join(tmp, 'no-such-dir-file'), 'a file, not a folder');
    const db = openDatabase(file);
    expect(() => migrate(db, { dir: migrationsDir({ '002_x.sql': 'SELECT 1;' }), backupFile: () => target })).toThrow(
      /Backup before upgrade failed/,
    );
    expect(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v).toBe(1);
    expect(fs.readdirSync(tmp).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    db.close();
  });

  it('skips a migration another process applied after this one looked', () => {
    const file = path.join(tmp, 'race.db');
    openStorage(file, { dir: migrationsDir(), backupFile: null }).close();
    const dir = migrationsDir({ '002_add_note.sql': 'ALTER TABLE routing_decisions ADD COLUMN note TEXT;' });
    const a = openDatabase(file);
    const b = openDatabase(file);
    const result = migrate(b, {
      dir,
      // Runs after b has read the applied versions and before it applies 002.
      backupFile: () => {
        migrate(a, { dir });
        return path.join(tmp, 'race.bak');
      },
    });
    expect(result.applied).toEqual([]);
    expect(b.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n).toBe(2);
    a.close();
    b.close();
  });

  it('runs migrations with foreign keys off so a table rebuild keeps child rows', () => {
    const file = path.join(tmp, 'fk.db');
    const storage = openStorage(file, { dir: migrationsDir(), backupFile: null });
    storage.decisions.insert(decision());
    storage.db
      .prepare("INSERT INTO usage_records (decision_id, session_id, agent_id, model, recorded_at) VALUES ('d-1', 's-1', 'claude-code', 'm', 'now')")
      .run();
    storage.close();

    const rebuild = [
      'CREATE TABLE routing_decisions_new (id TEXT PRIMARY KEY, session_id TEXT NOT NULL);',
      'INSERT INTO routing_decisions_new SELECT id, session_id FROM routing_decisions;',
      'DROP TABLE routing_decisions;',
      'ALTER TABLE routing_decisions_new RENAME TO routing_decisions;',
    ].join('\n');
    const db = openDatabase(file);
    migrate(db, { dir: migrationsDir({ '002_rebuild.sql': rebuild }) });
    expect(db.prepare('SELECT decision_id FROM usage_records').get().decision_id).toBe('d-1');
    expect(db.prepare('PRAGMA foreign_keys').get().foreign_keys).toBe(1);
    db.close();
  });

  it('refuses a migration that leaves a foreign key violation', () => {
    const db = openDatabase(MEMORY);
    migrate(db, { dir: migrationsDir() });
    const orphan =
      "INSERT INTO usage_records (decision_id, session_id, agent_id, model, recorded_at) VALUES ('ghost', 's', 'a', 'm', 'now');";
    expect(() => migrate(db, { dir: migrationsDir({ '002_orphan.sql': orphan }) })).toThrow(/foreign key check failed/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM usage_records').get().n).toBe(0);
    db.close();
  });

  it('detects a gap in applied versions', () => {
    const db = openDatabase(MEMORY);
    migrate(db);
    db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?)').run(LATEST + 2, 'x', 'y', 'now');
    expect(() => migrate(db)).toThrow(new RegExp(`gap at version ${LATEST + 1}`));
    db.close();
  });

  it('refuses to overwrite an existing backup', () => {
    const file = path.join(tmp, 'smr.db');
    openStorage(file, { dir: migrationsDir() }).close();
    fs.writeFileSync(path.join(tmp, 'taken.bak'), 'x');
    const db = openDatabase(file);
    expect(() =>
      migrate(db, { dir: migrationsDir({ '002_x.sql': 'SELECT 1;' }), backupFile: () => path.join(tmp, 'taken.bak') }),
    ).toThrow(/Backup file already exists/);
    db.close();
  });

  it('rolls back a failing migration and leaves the version unchanged', () => {
    const db = openDatabase(MEMORY);
    migrate(db, { dir: migrationsDir() });
    const dir = migrationsDir({ '002_broken.sql': 'CREATE TABLE half (x INTEGER); THIS IS NOT SQL;' });
    expect(() => migrate(db, { dir })).toThrow(/Migration 2 \(broken\) failed/);
    expect(tables(db)).not.toContain('half');
    expect(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v).toBe(1);
    db.close();
  });

  it('refuses a database newer than the program', () => {
    const db = openDatabase(MEMORY);
    const next = String(LATEST + 1).padStart(3, '0');
    migrate(db, { dir: migrationsDir({ [`${next}_x.sql`]: 'SELECT 1;' }, { all: true }) });
    expect(() => migrate(db)).toThrow(/newer than this program supports/);
    db.close();
  });

  it('refuses when an applied migration file was changed', () => {
    const db = openDatabase(MEMORY);
    migrate(db);
    const dir = migrationsDir();
    fs.appendFileSync(path.join(dir, '001_initial.sql'), '\n-- edited\n');
    expect(() => migrate(db, { dir })).toThrow(/does not match its file/);
    db.close();
  });

  it('requires contiguous version numbers', () => {
    expect(() => listMigrations(migrationsDir({ '003_gap.sql': 'SELECT 1;' }))).toThrow(/contiguous/);
  });

  it('reads the shipped migrations with stable checksums', () => {
    const [first] = listMigrations();
    expect(first.version).toBe(1);
    expect(first.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(first.sql).not.toContain('\r');
  });
});

describe('decision repository', () => {
  let storage;
  beforeEach(() => {
    storage = openStorage(MEMORY);
  });
  afterEach(() => storage.close());

  it('round-trips a decision with classification and alternatives', () => {
    const input = decision({
      turnId: 't-1',
      classification: {
        taskType: 'bug_fix',
        complexity: 0.4,
        reasoning: 'medium',
        codingDepth: 'medium',
        risk: 'low',
        scope: 'single_file',
        confidence: 0.9,
      },
      alternatives: [{ model: 'anthropic.claude-haiku', score: 0.4, reason: 'cheaper, lower quality' }],
      status: 'applied',
      appliedModel: 'claude-sonnet-5-5',
    });
    const stored = storage.decisions.insert(input);
    expect(storage.decisions.findById('d-1')).toEqual(stored);
    expect(storage.db.prepare('SELECT task_type FROM routing_decisions').get().task_type).toBe('bug_fix');
  });

  it('rejects an invalid decision before touching the database', () => {
    expect(() => storage.decisions.insert(decision({ status: 'done' }))).toThrow(ValidationError);
    expect(storage.decisions.listRecent()).toEqual([]);
  });

  it('returns null for an unknown id', () => {
    expect(storage.decisions.findById('missing')).toBeNull();
  });

  it('lists newest first, filters by session and clamps the limit', () => {
    storage.decisions.insert(decision({ id: 'a', createdAt: '2026-11-18T09:00:00.000Z' }));
    storage.decisions.insert(decision({ id: 'b', createdAt: '2026-11-18T09:05:00.000Z' }));
    storage.decisions.insert(decision({ id: 'c', sessionId: 's-2', createdAt: '2026-11-18T09:10:00.000Z' }));
    expect(storage.decisions.listRecent().map((d) => d.id)).toEqual(['c', 'b', 'a']);
    expect(storage.decisions.listRecent({ sessionId: 's-1' }).map((d) => d.id)).toEqual(['b', 'a']);
    expect(storage.decisions.listRecent({ limit: 0 })).toHaveLength(1);
    expect(storage.decisions.listRecent({ limit: 'x' })).toHaveLength(1);
    expect(storage.decisions.listRecent({ limit: 10_000 })).toHaveLength(3);
  });

  it('normalises createdAt so text ordering is time ordering', () => {
    storage.decisions.insert(decision({ id: 'whole', createdAt: '2026-11-18T09:00:00Z' }));
    storage.decisions.insert(decision({ id: 'half', createdAt: '2026-11-18T09:00:00.500Z' }));
    expect(storage.decisions.findById('whole').createdAt).toBe('2026-11-18T09:00:00.000Z');
    expect(storage.decisions.listRecent().map((d) => d.id)).toEqual(['half', 'whole']);
  });

  it('reports a duplicate id as a StorageError', () => {
    storage.decisions.insert(decision());
    expect(() => storage.decisions.insert(decision())).toThrow(/already exists/);
  });

  it('wraps other insert failures', () => {
    storage.db.exec('DROP TABLE routing_decisions');
    expect(() => storage.decisions.insert(decision({ id: 'x' }))).toThrow(StorageError);
  });

  it('reports a corrupt JSON column as a StorageError', () => {
    storage.decisions.insert(decision());
    storage.db.prepare("UPDATE routing_decisions SET alternatives_json = '{oops' WHERE id = 'd-1'").run();
    expect(() => storage.decisions.findById('d-1')).toThrow(/Corrupt JSON in routing_decisions\.alternatives_json \(id=d-1\)/);
  });

  it('treats a hostile session id as data, not SQL', () => {
    storage.decisions.insert(decision());
    expect(storage.decisions.listRecent({ sessionId: "s-1' OR '1'='1" })).toEqual([]);
  });
});

describe('settings repository', () => {
  it('sets, gets, updates and deletes JSON values', () => {
    const storage = openStorage(MEMORY, { settingsSchemas: SETTINGS_SCHEMAS });
    const repo = storage.settings;
    expect(repo.get('dashboard.token-hash')).toBeUndefined();
    repo.set('dashboard.token-hash', { v: 1 });
    repo.set('dashboard.token-hash', { v: 2 });
    expect(repo.get('dashboard.token-hash')).toEqual({ v: 2 });
    expect(repo.delete('dashboard.token-hash')).toBe(true);
    expect(repo.delete('dashboard.token-hash')).toBe(false);
    storage.close();
  });

  it('validates keys and values', () => {
    const db = openDatabase(MEMORY);
    migrate(db);
    const repo = createSettingsRepository(db, { now: () => new Date('2026-11-18T00:00:00Z'), schemas: SETTINGS_SCHEMAS });
    expect(() => repo.get('Bad Key')).toThrow(ValidationError);
    expect(() => repo.set('ok', undefined)).toThrow(ValidationError);
    expect(() => repo.set('ok', 'yes')).toThrow(/Invalid value for settings key ok/);
    expect(() => repo.set(42, 1)).toThrow(ValidationError);
    expect(() => repo.set('anthropic.api-key', 'sk-ant-x')).toThrow(/Unknown settings key/);
    expect(() => repo.set('blob', 'x'.repeat(70 * 1024))).toThrow(/larger than/);
    expect(() => repo.delete('Bad Key')).toThrow(ValidationError);
    repo.set('ok', false);
    expect(db.prepare('SELECT updated_at FROM settings').get().updated_at).toBe('2026-11-18T00:00:00.000Z');
    db.close();
  });

  it('reports a corrupt stored value as a StorageError', () => {
    const storage = openStorage(MEMORY, { settingsSchemas: SETTINGS_SCHEMAS });
    storage.db.prepare("INSERT INTO settings VALUES ('ok', '{bad', 'now')").run();
    expect(() => storage.settings.get('ok')).toThrow(StorageError);
    storage.close();
  });

  it('works with no schemas registered (every key refused)', () => {
    const storage = openStorage(MEMORY);
    expect(() => storage.settings.get('anything')).toThrow(/Unknown settings key/);
    storage.close();
  });
});

describe('openStorage', () => {
  it('closes the database when migration fails', () => {
    const file = path.join(tmp, 'smr.db');
    const db = openDatabase(file);
    migrate(db, { dir: migrationsDir({ '002_x.sql': 'SELECT 1;' }) });
    db.close();
    expect(() => openStorage(file)).toThrow(StorageError);
    // The file is not locked by a leaked handle: it can be removed.
    expect(() => fs.rmSync(file)).not.toThrow();
  });

  it('lets two connections to one file write without interfering', () => {
    const file = path.join(tmp, 'shared.db');
    const a = openStorage(file);
    const b = openStorage(file);
    a.decisions.insert(decision({ id: 'from-a', sessionId: 'session-a' }));
    b.decisions.insert(decision({ id: 'from-b', sessionId: 'session-b' }));
    expect(a.decisions.listRecent({ sessionId: 'session-b' }).map((d) => d.id)).toEqual(['from-b']);
    expect(b.decisions.listRecent({ sessionId: 'session-a' }).map((d) => d.id)).toEqual(['from-a']);
    a.close();
    b.close();
  });
});
