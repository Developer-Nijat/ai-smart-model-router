'use strict';

const { CliError } = require('./errors');

/**
 * A plain-text table: columns padded to their widest cell, no colours (works in any
 * terminal and when piped).
 *
 * @param {string[]} headers
 * @param {unknown[][]} rows
 */
function table(headers, rows) {
  const cells = [headers, ...rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? '-' : String(cell))))];
  const widths = headers.map((_, i) => Math.max(...cells.map((row) => row[i].length)));
  return cells.map((row) => row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]))).join('  ')).join('\n');
}

const UNITS = Object.freeze({ h: 3_600_000, d: 86_400_000, w: 604_800_000 });

/**
 * `7d`, `24h`, `2w` → the ISO time that long before `now`; `all` → null.
 * @param {string} text
 * @param {Date} now
 */
function parseSince(text, now) {
  if (text === 'all') return null;
  const match = /^(\d{1,4})([hdw])$/.exec(String(text));
  if (!match) throw new CliError(`--since takes a period like 24h, 7d, 2w or all (got "${String(text).slice(0, 20)}")`);
  return new Date(now.getTime() - Number(match[1]) * UNITS[match[2]]).toISOString();
}

/** A positive integer option, within bounds. */
function parseCount(text, { name, min = 1, max }) {
  const value = Number(text);
  if (!Number.isInteger(value) || value < min || value > max) throw new CliError(`${name} must be a whole number from ${min} to ${max}`);
  return value;
}

const usd = (value) => (value === null || value === undefined ? 'unknown' : `$${value.toFixed(4)}`);
const pct = (n, total) => (total === 0 ? '0%' : `${Math.round((n / total) * 100)}%`);
const shortModel = (id) => (id ? String(id).replace(/^anthropic\.claude-/, '') : '-');
const int = (n) => Number(n ?? 0).toLocaleString('en-US');

module.exports = { table, parseSince, parseCount, usd, pct, shortModel, int };
