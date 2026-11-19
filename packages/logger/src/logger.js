'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { LOG_LEVELS } = require('@smr/shared');
const { redact, redactString } = require('./redact');

const RANK = Object.freeze(Object.fromEntries(LOG_LEVELS.map((level, index) => [level, index])));
const RESERVED = Object.freeze(['ts', 'level', 'msg']);

/** Writes each line to stderr: stdout stays clean for command output. */
function stderrSink(line) {
  process.stderr.write(`${line}\n`);
}

/**
 * Appends each line to a file readable by the owner only, creating its folder on first use.
 * Rotation arrives with the CLI in Phase 4.
 * @param {string} file
 * @returns {(line: string) => void}
 */
function createFileSink(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return (line) => fs.appendFileSync(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 });
}

function withoutReserved(fields) {
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) return {};
  return Object.fromEntries(Object.entries(fields).filter(([key]) => !RESERVED.includes(key)));
}

/**
 * A structured JSON-lines logger. The message and every field pass through redaction,
 * and fields can never overwrite `ts`, `level` or `msg`. Logging is best effort:
 * nothing here throws into the caller.
 *
 * @param {{ level?: string, sinks?: Array<(line: string) => void>, bindings?: object, now?: () => Date }} [options]
 */
function createLogger(options = {}) {
  const level = options.level ?? 'info';
  if (!(level in RANK)) throw new TypeError(`Unknown log level: ${level}`);
  const sinks = Object.freeze([...(options.sinks ?? [stderrSink])]);
  const bindings = Object.freeze({ ...(options.bindings ?? {}) });
  const now = options.now ?? (() => new Date());

  function format(entryLevel, msg, fields) {
    try {
      const entry = redact({ ...bindings, ...withoutReserved(fields) });
      return JSON.stringify({
        ts: now().toISOString(),
        level: entryLevel,
        msg: redactString(String(msg)),
        ...withoutReserved(entry),
      });
    } catch {
      return JSON.stringify({ ts: new Date().toISOString(), level: entryLevel, msg: '[log entry could not be serialized]' });
    }
  }

  function write(entryLevel, msg, fields) {
    if (RANK[entryLevel] < RANK[level]) return;
    const line = format(entryLevel, msg, fields);
    for (const sink of sinks) {
      try {
        sink(line);
      } catch {
        // Best effort: a broken sink must not take routing down with it.
      }
    }
  }

  return Object.freeze({
    level,
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
    /** A logger that adds `extra` to every entry; the parent is unchanged. */
    child: (extra) => createLogger({ level, sinks, now, bindings: { ...bindings, ...withoutReserved(extra) } }),
  });
}

module.exports = { createLogger, createFileSink, stderrSink };
