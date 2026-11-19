'use strict';

const { ValidationError } = require('@smr/shared');
const { parseColumn } = require('./json');

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/;
/** Runtime state is small; a large value is a bug or misuse. */
const MAX_VALUE_BYTES = 64 * 1024;

function checkKey(key) {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw new ValidationError(`Invalid settings key: ${String(key)}`, ['key: lowercase letters, digits, . _ -; 1-100 chars']);
  }
}

/**
 * Runtime key/value state kept in the database (not the user's config.json).
 *
 * `schemas` maps a key to the Zod schema its value must satisfy; a key without a
 * schema is refused, so nothing (a credential, say) is stored by accident.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ now?: () => Date, schemas?: Record<string, import('zod').ZodType> }} [options]
 */
function createSettingsRepository(db, options = {}) {
  const now = options.now ?? (() => new Date());
  const schemas = Object.freeze({ ...(options.schemas ?? {}) });
  const getStmt = db.prepare('SELECT value_json FROM settings WHERE key = ?');
  const setStmt = db.prepare(`INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`);
  const deleteStmt = db.prepare('DELETE FROM settings WHERE key = ?');

  function schemaFor(key) {
    checkKey(key);
    const schema = schemas[key];
    if (!schema) throw new ValidationError(`Unknown settings key: ${key}`, [`key: no schema registered for ${key}`]);
    return schema;
  }

  return Object.freeze({
    /** @returns the stored value, or undefined when the key is absent */
    get(key) {
      schemaFor(key);
      const row = getStmt.get(key);
      return row ? parseColumn(row.value_json, undefined, `settings.value_json (key=${key})`) : undefined;
    },

    set(key, value) {
      const schema = schemaFor(key);
      const result = schema.safeParse(value);
      if (!result.success) {
        throw new ValidationError(`Invalid value for settings key ${key}`, result.error.issues.map((i) => i.message));
      }
      const json = JSON.stringify(result.data);
      if (Buffer.byteLength(json, 'utf8') > MAX_VALUE_BYTES) {
        throw new ValidationError(`Value for settings key ${key} is larger than ${MAX_VALUE_BYTES} bytes`, ['value: too large']);
      }
      setStmt.run(key, json, now().toISOString());
      return result.data;
    },

    delete(key) {
      checkKey(key);
      return deleteStmt.run(key).changes > 0;
    },
  });
}

module.exports = { createSettingsRepository, MAX_VALUE_BYTES };
