'use strict';

const fs = require('node:fs');
const { compileRules, describeModels } = require('@smr/core');
const { detectAgents } = require('@smr/adapters');
const { table, shortModel } = require('../format');
const { CliError } = require('../errors');

async function agents(ctx, options) {
  const found = await detectAgents({ registry: ctx.registry(), detectors: ctx.detectors, now: ctx.now });
  ctx.withStorage((storage) => found.forEach((agent) => storage.agents.save(agent)));
  if (options.json) return ctx.printJson(found);
  const supported = (caps) => Object.entries(caps).filter(([, on]) => on).map(([name]) => name);
  ctx.print(
    table(
      ['agent', 'installed', 'version', 'routing'],
      found.map((a) => [a.id, a.installed ? 'yes' : 'no', a.version, supported(a.capabilities).length > 0 ? 'turn + subagent + effort' : 'detection only']),
    ),
  );
  for (const a of found) for (const note of a.notes) ctx.print(`  ${a.id}: ${note}`);
  return undefined;
}

function models(ctx, options) {
  const rows = describeModels(ctx.registry(), ctx.now().toISOString().slice(0, 10));
  if (options.json) return ctx.printJson(rows);
  ctx.print(
    table(
      ['model', 'claude code', 'tier', 'status', 'USD/M in', 'USD/M out', 'as of'],
      rows.map((m) => [shortModel(m.id), m.claudeCode, m.tier, m.status, m.price?.inputPerMillion, m.price?.outputPerMillion, m.price?.asOf]),
    ),
  );
  const sources = [...new Set(rows.map((m) => m.price?.sourceUrl).filter(Boolean))];
  for (const source of sources) ctx.print(`prices: ${source}`);
  return undefined;
}

function readRulesFile(file) {
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new CliError(`cannot read ${file}: ${error.code === 'ENOENT' ? 'no such file' : error.message}`);
  }
  if (!Array.isArray(json)) throw new CliError(`${file} must hold a JSON array of rules`);
  return json;
}

function rules(ctx, action, file, options) {
  if (action === 'path') return ctx.print(ctx.paths.rulesFile);
  if (action === 'validate') {
    const target = file ?? ctx.paths.rulesFile;
    try {
      const compiled = compileRules(readRulesFile(target));
      return ctx.print(`${target}: ${compiled.length} rule(s) valid`);
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError(`${target}: ${error.message}${error.issues ? `\n  ${error.issues.join('\n  ')}` : ''}`);
    }
  }
  if (action && action !== 'list') throw new CliError(`unknown action ${String(action).slice(0, 20)}: use list, validate [file] or path`);
  const userIds = new Set(fs.existsSync(ctx.paths.rulesFile) ? readRulesFile(ctx.paths.rulesFile).map((r) => r?.id) : []);
  const compiled = compileRules(ctx.rules());
  if (options.json) return ctx.printJson(compiled.map((rule) => ({ ...rule, source: userIds.has(rule.id) ? 'user' : 'shipped' })));
  if (compiled.length === 0) {
    ctx.print(`no routing rules; add your own to ${ctx.paths.rulesFile} (see docs/routing-engine.md)`);
    return undefined;
  }
  ctx.print(
    table(
      ['id', 'priority', 'source', 'when', 'then'],
      compiled.map((r) => [r.id, r.priority, userIds.has(r.id) ? 'user' : 'shipped', JSON.stringify(r.when), JSON.stringify(r.then)]),
    ),
  );
  return undefined;
}

function register(program, ctx) {
  program
    .command('agents')
    .description('detect installed coding agents and what routing each supports')
    .option('--json', 'machine-readable output')
    .action((options) => agents(ctx, options));
  program
    .command('models')
    .description('the model registry with sourced prices')
    .option('--json', 'machine-readable output')
    .action((options) => models(ctx, options));
  program
    .command('rules')
    .description('routing rules: list | validate [file] | path')
    .argument('[action]')
    .argument('[file]')
    .option('--json', 'machine-readable output')
    .action((action, file, options) => rules(ctx, action, file, options));
}

module.exports = { register, agents, models, rules };
