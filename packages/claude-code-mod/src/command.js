'use strict';

const { ROUTING_MODES, EFFORT_LEVELS } = require('@smr/shared');

const HELP = [
  '/route                      status: mode, override, last decision',
  '/route auto|shadow|off      auto applies decisions; shadow only records them; off disables routing',
  '/route <model> [effort] [once]',
  '                            manual override, e.g. /route opus, /route sonnet high once',
  '/route clear                remove the manual override',
  '/route explain              why the last turn got its model',
  '/route stats                decisions, models and estimated cost this session',
].join('\n');

const MAX_ECHO = 40;

/**
 * Parses the `/route` arguments. Pure: the caller applies the result.
 *
 * @param {string} args
 * @param {{ resolveManual: (word: string) => { id: string, supportedEffort: readonly string[] } | null }} router
 * @returns {{ kind: string, [key: string]: unknown }}
 */
function parseRouteCommand(args, router) {
  const words = String(args ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const [first, ...rest] = words;
  if (!first || first === 'status') return { kind: 'status' };
  if (['help', '-h', '--help'].includes(first)) return { kind: 'help' };
  if (ROUTING_MODES.includes(first)) return rest.length === 0 ? { kind: 'mode', mode: first } : unexpected(rest[0]);
  if (['clear', 'explain', 'stats'].includes(first)) return rest.length === 0 ? { kind: first } : unexpected(rest[0]);

  const model = router.resolveManual(first);
  if (!model) return { kind: 'error', message: `unknown command or model "${first.slice(0, MAX_ECHO)}"\n${HELP}` };
  let effort = null;
  let scope = 'session';
  for (const word of rest) {
    if (word === 'once') scope = 'turn';
    else if (EFFORT_LEVELS.includes(word) && effort === null) effort = word;
    else return unexpected(word);
  }
  if (effort && !model.supportedEffort.includes(effort)) {
    return { kind: 'error', message: `${model.id} does not take effort ${effort} (supports: ${model.supportedEffort.join(', ') || 'none'})` };
  }
  return { kind: 'override', model: model.id, effort, scope };
}

function unexpected(word) {
  return { kind: 'error', message: `unexpected "${word.slice(0, MAX_ECHO)}"\n${HELP}` };
}

const pct = (n, total) => (total === 0 ? '0%' : `${Math.round((n / total) * 100)}%`);
const usd = (value) => (value === null ? 'unknown' : `$${value.toFixed(4)}`);

/** One line per record: what was picked, what was done, who answered. */
function formatRecord(record) {
  const d = record.decision;
  const who = d.subagentId ? 'subagent' : 'main';
  const pick = `${d.selection.model}${d.selection.effort ? `/${d.selection.effort}` : ''}`;
  const answered = record.answeredBy.length > 0 ? record.answeredBy.join(',') : '?';
  return `[${d.mode}] ${who} ${d.status}: ${pick} (${d.decisionSource}); answered by ${answered}; ${record.steps} step(s); cost ${usd(d.estimatedCostUsd)}`;
}

/** The newest main-session record: subagents finish in their own order. */
function lastMainRecord(records) {
  return records.findLast((record) => !record.decision.subagentId);
}

function formatStatus({ mode, override, warnings, records }) {
  const lines = [
    `mode: ${mode}`,
    `override: ${override ? `${override.model}${override.effort ? `/${override.effort}` : ''} (${override.scope === 'turn' ? 'next turn' : 'session'})` : 'none'}`,
  ];
  for (const warning of warnings) lines.push(`settings warning: ${warning}`);
  const last = lastMainRecord(records);
  lines.push(last ? `last: ${formatRecord(last)}` : 'last: no routed turn yet');
  lines.push('/route help for commands');
  return lines.join('\n');
}

function formatExplain(record) {
  if (!record) return 'No routed turn yet.';
  const d = record.decision;
  const c = d.classification;
  const lines = [formatRecord(record), `reason: ${d.reason}`];
  if (c) lines.push(`task: ${c.taskType}, complexity ${c.complexity}, reasoning ${c.reasoning}, risk ${c.risk}, scope ${c.scope}, confidence ${c.confidence}`);
  for (const alt of d.alternatives) lines.push(`  alternative ${alt.model}: score ${alt.score} (${alt.reason})`);
  if (!record.verified && d.status !== 'skipped') lines.push('not verified: Claude Code reported no usage for this turn');
  for (const note of record.trace) lines.push(`  trace: ${note}`);
  return lines.join('\n');
}

/** Aggregates over the records the mod keeps (this session's recent turns). */
function summarize(records) {
  const byModel = {};
  const byStatus = {};
  let cost = 0;
  let unknownCost = 0;
  let subagentTurns = 0;
  for (const record of records) {
    const d = record.decision;
    if (d.subagentId) subagentTurns += 1;
    const answered = record.answeredBy.at(-1) ?? 'unknown';
    byModel[answered] = (byModel[answered] ?? 0) + 1;
    byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
    if (d.estimatedCostUsd === null) unknownCost += 1;
    else cost += d.estimatedCostUsd;
  }
  return { total: records.length, subagentTurns, byModel, byStatus, costUsd: Math.round(cost * 1e6) / 1e6, unknownCost };
}

function formatStats(records) {
  const s = summarize(records);
  if (s.total === 0) return 'No routed turn yet.';
  const lines = [`turns: ${s.total} (${s.total - s.subagentTurns} main, ${s.subagentTurns} subagent)`];
  for (const [model, n] of Object.entries(s.byModel)) lines.push(`  answered by ${model}: ${n} (${pct(n, s.total)})`);
  for (const [status, n] of Object.entries(s.byStatus)) lines.push(`  ${status}: ${n}`);
  lines.push(`estimated cost: ${usd(s.costUsd)}${s.unknownCost > 0 ? ` (+${s.unknownCost} turn(s) with unknown price)` : ''}`);
  lines.push('API list prices; on a subscription this is a comparison figure, not a charge.');
  return lines.join('\n');
}

/** The status-line text after a main turn. */
function statusLine(record) {
  const d = record.decision;
  const arrow = d.status === 'applied' ? '→' : d.status === 'failed' ? '✗' : '≈';
  const pick = `${d.selection.model.replace(/^anthropic\.claude-/, '')}${d.selection.effort ? `/${d.selection.effort}` : ''}`;
  return `router[${d.mode}] ${arrow} ${pick}`;
}

module.exports = { parseRouteCommand, lastMainRecord, formatRecord, formatStatus, formatExplain, formatStats, summarize, statusLine, HELP };
