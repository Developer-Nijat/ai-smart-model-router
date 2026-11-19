'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { z } = require('zod');
const { SettingsSchema, formatIssues } = require('@smr/shared');
const { decide, createSessionState, withContext, compileRules } = require('@smr/core');
const { table, pct, shortModel } = require('../format');
const { CliError } = require('../errors');

const AGENT = Object.freeze({
  id: 'claude-code',
  capabilities: Object.freeze({ turnLevelRouting: true, subagentRouting: true, effortControl: true }),
});
const FAMILY_TIER = Object.freeze({ haiku: 1, sonnet: 2, opus: 3, fable: 4 });

const PromptSetSchema = z.object({
  version: z.literal(1),
  labels: z.string().min(1),
  prompts: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        lang: z.string().min(2).max(10).optional(),
        expected: z.enum(Object.keys(FAMILY_TIER)),
        text: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(1000),
});

function loadPromptSet(file) {
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new CliError(`cannot read ${file}: ${error.code === 'ENOENT' ? 'no such file' : error.message}`);
  }
  const result = PromptSetSchema.safeParse(json);
  if (!result.success) throw new CliError(`${file} is not a prompt set: ${formatIssues(result.error).join('; ')}`);
  return result.data;
}

/** Blended list price (75% input, 25% output) per million tokens; null when unknown. */
function blendedPrice(registry, modelId, day) {
  const price = registry.pricingFor(modelId, day);
  if (!price || price.inputPerMillion === null || price.outputPerMillion === null) return null;
  return 0.75 * price.inputPerMillion + 0.25 * price.outputPerMillion;
}

/**
 * Runs every prompt through the router (rules classifier, fresh session, auto mode) and
 * through fixed one-model strategies, and compares each pick with the label:
 * - match: picked the expected tier;
 * - under: picked a weaker tier (quality risk);
 * - over: picked a stronger tier (cost waste);
 * - price index: mean blended list price of the picks, relative to always the strongest.
 * No model is called and no token is spent.
 */
function runBenchmark({ registry, rules, set, day, createdAt }) {
  const settings = SettingsSchema.parse({ routing: { mode: 'auto' } });
  const compiled = compileRules(rules);
  const candidates = registry.candidatesFor(AGENT.id);
  if (candidates.length === 0) throw new CliError('no enabled model for Claude Code in the registry');
  const strongest = candidates.at(-1);
  const strategies = [
    { name: 'router', pick: (prompt, i) => routerPick(prompt, i) },
    ...candidates.map((model) => ({ name: `always-${shortModel(model.id)}`, pick: () => ({ model: model.id, effort: null }) })),
  ];

  function routerPick(prompt, index) {
    const session = withContext(createSessionState({ sessionId: 'benchmark', agentId: AGENT.id }), 0);
    const { decision } = decide({
      ids: { decisionId: `bench-${index}` },
      createdAt,
      agent: AGENT,
      settings,
      registry,
      rules: compiled,
      session,
      text: prompt.text,
    });
    return { model: decision?.selection.model ?? null, effort: decision?.selection.effort ?? null };
  }

  const reference = blendedPrice(registry, strongest.id, day);
  const results = strategies.map((strategy) => {
    const rows = set.prompts.map((prompt, i) => {
      const picked = strategy.pick(prompt, i);
      const tier = registry.get(picked.model)?.tier ?? null;
      const expected = FAMILY_TIER[prompt.expected];
      return { id: prompt.id, expected: prompt.expected, model: picked.model, effort: picked.effort, verdict: tier === expected ? 'match' : tier < expected ? 'under' : 'over' };
    });
    const count = (verdict) => rows.filter((row) => row.verdict === verdict).length;
    const prices = rows.map((row) => blendedPrice(registry, row.model, day));
    const priceIndex = reference && prices.every((p) => p !== null) ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length / reference) * 1000) / 1000 : null;
    return { strategy: strategy.name, total: rows.length, match: count('match'), under: count('under'), over: count('over'), priceIndex, rows };
  });
  return { prompts: set.prompts.length, labels: set.labels, reference: strongest.id, results };
}

function benchmark(ctx, options) {
  const file = options.file ?? path.join(ctx.dataDir, 'benchmark', 'prompts.json');
  const set = loadPromptSet(file);
  const startedAt = ctx.now().toISOString();
  const summary = runBenchmark({ registry: ctx.registry(), rules: ctx.rules(), set, day: startedAt.slice(0, 10), createdAt: startedAt });
  const id = `bench-${startedAt.replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
  if (fs.existsSync(ctx.paths.dbFile)) {
    const stored = { ...summary, results: summary.results.map(({ rows, ...rest }) => (rest.strategy === 'router' ? { ...rest, rows } : rest)) };
    ctx.withStorage((storage) => storage.benchmarks.save({ id, strategy: 'router-vs-fixed', startedAt, finishedAt: ctx.now().toISOString(), summary: stored }));
  }
  if (options.json) return ctx.printJson({ id, file, ...summary });

  ctx.print(`prompts: ${summary.prompts} (${file})`);
  ctx.print(`labels: ${summary.labels}`);
  ctx.print(
    table(
      ['strategy', 'match', 'under (quality risk)', 'over (cost waste)', `price vs ${shortModel(summary.reference)}`],
      summary.results.map((r) => [r.strategy, `${r.match}/${r.total} (${pct(r.match, r.total)})`, r.under, r.over, r.priceIndex ?? 'unknown']),
    ),
  );
  const router = summary.results.find((r) => r.strategy === 'router');
  const misses = router.rows.filter((row) => row.verdict !== 'match');
  if (misses.length > 0) {
    ctx.print('\nrouter misses:');
    for (const row of misses) ctx.print(`  ${row.id}: expected ${row.expected}, picked ${shortModel(row.model)}${row.effort ? `/${row.effort}` : ''} (${row.verdict})`);
  }
  ctx.print('\nNo model was called. Price index uses blended list prices (75% input, 25% output), not real token counts.');
  return undefined;
}

function register(program, ctx) {
  program
    .command('benchmark')
    .description('compare the router with fixed one-model strategies on a labelled prompt set (offline)')
    .option('--file <path>', 'prompt set JSON (default: data/benchmark/prompts.json)')
    .option('--json', 'machine-readable output')
    .action((options) => benchmark(ctx, options));
}

module.exports = { register, benchmark, runBenchmark, loadPromptSet };
