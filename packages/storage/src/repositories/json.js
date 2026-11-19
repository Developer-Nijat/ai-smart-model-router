'use strict';

const { StorageError } = require('@smr/shared');

/**
 * Parses a JSON column; a corrupt row becomes a StorageError naming where it was.
 * @param {string | null | undefined} text
 * @param {unknown} fallback returned for NULL
 * @param {string} where e.g. `routing_decisions.alternatives_json (id=d-1)`
 */
function parseColumn(text, fallback, where) {
  if (text === null || text === undefined) return fallback;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new StorageError(`Corrupt JSON in ${where}: ${error.message}`, { where });
  }
}

/** True when `error` is SQLite refusing a duplicate key. */
function isUniqueViolation(error) {
  return /UNIQUE constraint failed|PRIMARY KEY/i.test(String(error && error.message));
}

module.exports = { parseColumn, isUniqueViolation };
