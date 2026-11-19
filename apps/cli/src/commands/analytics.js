'use strict';

const fs = require('node:fs');
const { costComparison } = require('@smr/core');
const { table, parseSince, parseCount, usd, pct, shortModel, int } = require('../format');

function noData(ctx) {
  if (fs.existsSync(ctx.paths.dbFile)) return false;
  ctx.print('no data yet: run mr init and mr start, then use Claude Code with the mod');
  return true;
}

function stats(ctx, options) {
  if (noData(ctx)) return undefined;
  const since = parseSince(options.since, ctx.now());
  const registry = ctx.registry();
  const { s, usage } = ctx.withStorage((storage) => ({ s: storage.records.stats({ since }), usage: storage.records.usage({ since }) }));
  const comparison = costComparison(registry, usage);
  if (options.json) return ctx.printJson({ since, ...s, comparison });

  ctx.print(`period: ${since ? `since ${since}` : 'all time'}`);
  if (s.total === 0) {
    ctx.print('no routed turns in this period');
    return undefined;
  }
  ctx.print(`turns: ${s.total} (${s.mainTurns} main, ${s.subagentTurns} subagent) in ${s.sessions} session(s)`);
  const block = (title, counts) => {
    ctx.print(`\n${title}`);
    ctx.print(table(['', 'turns', 'share'], Object.entries(counts).map(([k, n]) => [shortModel(k), n, pct(n, s.total)])));
  };
  block('answered by', s.byAnsweredModel);
  block('status', s.byStatus);
  block('task type', s.byTaskType);
  block('decided by', s.bySource);
  ctx.print(`\ntokens: input ${int(s.tokens.input)}, output ${int(s.tokens.output)}, cache read ${int(s.tokens.cacheRead)}, cache write ${int(s.tokens.cacheWrite)}`);
  ctx.print(`estimated cost: ${usd(s.knownCostUsd)}${s.unknownCostTurns > 0 ? ` + ${s.unknownCostTurns} turn(s) with an unknown price` : ''}`);
  ctx.print(`same tokens priced on one model (approximation; ${comparison.turnsWithUsage} turn(s) with usage):`);
  if (comparison.excludedTurns > 0) ctx.print(`  over ${comparison.comparedTurns} turn(s) priced on every model; ${comparison.excludedTurns} left out (unknown price)`);
  ctx.print(`  as answered: ${usd(comparison.actualUsd)}`);
  for (const [model, cost] of Object.entries(comparison.sameTokensOnlyOn)) ctx.print(`  ${shortModel(model)}: ${usd(cost)}`);
  ctx.print('API list prices; on a subscription these are comparison figures, not charges.');
  return undefined;
}

function history(ctx, options) {
  if (noData(ctx)) return undefined;
  const limit = parseCount(options.limit, { name: '--limit', max: 500 });
  const entries = ctx.withStorage((storage) =>
    storage.records.history({ limit, sessionId: options.session, status: options.status, since: options.since ? parseSince(options.since, ctx.now()) : null }),
  );
  if (options.json) return ctx.printJson(entries);
  if (entries.length === 0) {
    ctx.print('no routed turns yet');
    return undefined;
  }
  ctx.print(
    table(
      ['time', 'who', 'mode', 'status', 'picked', 'answered', 'task', 'cost'],
      entries.map((e) => [
        e.createdAt.replace('T', ' ').slice(0, 19),
        e.subagentId ? 'sub' : 'main',
        e.mode,
        e.status,
        `${shortModel(e.selection.model)}${e.selection.effort ? `/${e.selection.effort}` : ''}`,
        e.appliedModel,
        e.taskType,
        usd(e.estimatedCostUsd),
      ]),
    ),
  );
  if (options.reasons) for (const e of entries) ctx.print(`${e.id}: ${e.reason}`);
  return undefined;
}

function register(program, ctx) {
  program
    .command('stats')
    .description('routing and usage statistics')
    .option('--since <period>', 'period: 24h, 7d, 2w or all', '30d')
    .option('--json', 'machine-readable output')
    .action((options) => stats(ctx, options));
  program
    .command('history')
    .description('recent routing decisions, newest first')
    .option('--limit <n>', 'how many (1-500)', '20')
    .option('--session <id>', 'only this session')
    .option('--status <status>', 'only this status (applied, failed, recommended, skipped, unsupported)')
    .option('--since <period>', 'period: 24h, 7d, 2w or all')
    .option('--reasons', 'print each decision reason')
    .option('--json', 'machine-readable output')
    .action((options) => history(ctx, options));
}

module.exports = { register, stats, history };
