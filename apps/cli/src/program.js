'use strict';

const { Command } = require('commander');
const { version } = require('../package.json');
const { createContext } = require('./context');
const { CliError } = require('./errors');

// Static requires, so the release bundler sees every command.
const COMMANDS = [
  require('./commands/setup'),
  require('./commands/daemon'),
  require('./commands/dashboard'),
  require('./commands/catalog'),
  require('./commands/analytics'),
  require('./commands/doctor'),
  require('./commands/benchmark'),
  require('./commands/uninstall'),
];

/**
 * Builds the `mr` command.
 *
 * @param {{ writeOut?: (text: string) => void, writeErr?: (text: string) => void, context?: object }} [io]
 */
function createProgram(io = {}) {
  const program = new Command();
  program
    .name('mr')
    .description('Smart Model Router: picks the model and reasoning effort for each coding task.')
    .version(version, '-v, --version', 'print the version');

  if (io.writeOut || io.writeErr) {
    program.configureOutput({
      ...(io.writeOut ? { writeOut: io.writeOut } : {}),
      ...(io.writeErr ? { writeErr: io.writeErr } : {}),
    });
  }
  const ctx = io.context ?? createContext({ out: io.writeOut, err: io.writeErr });
  for (const command of COMMANDS) command.register(program, ctx);
  return program;
}

/**
 * Runs the CLI. Known failures print one line; anything else prints its message too,
 * never a stack (it may hold local paths).
 *
 * @param {string[]} argv full process argv
 * @param {{ writeErr?: (text: string) => void }} [io]
 */
async function run(argv, io = {}) {
  const writeErr = io.writeErr ?? ((text) => process.stderr.write(text));
  try {
    await createProgram(io).parseAsync(argv);
  } catch (error) {
    writeErr(`mr: ${error.message}\n`);
    process.exitCode = error instanceof CliError ? error.exitCode : 1;
  }
}

module.exports = { createProgram, run, version };
