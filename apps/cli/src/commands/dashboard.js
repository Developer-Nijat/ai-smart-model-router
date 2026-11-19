'use strict';

const { readToken } = require('@smr/config');
const { CliError } = require('../errors');
const { probe } = require('./daemon');

const CODE_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Opens the dashboard signed in. The browser never sees the API token: the daemon hands
 * out a one-time code (valid a minute) that the page trades for a session. The code
 * travels in the URL fragment, which browsers send to no server and keep out of Referer.
 */
async function dashboard(ctx, options) {
  const port = ctx.settings().server.port;
  const running = await probe(ctx, port);
  if (!running) throw new CliError('the daemon is not running: mr start');
  if (!running.verified) throw new CliError(`port ${port} is held by a program that did not prove it is this daemon`);

  let res;
  try {
    res = await ctx.fetch(`http://127.0.0.1:${port}/v1/dashboard/code`, {
      method: 'POST',
      headers: { authorization: `Bearer ${readToken(ctx.paths.tokenFile)}` },
      signal: AbortSignal.timeout(2000),
    });
  } catch (error) {
    throw new CliError(`could not reach the daemon: ${error.message}`);
  }
  if (res.status === 404) throw new CliError('this daemon has no dashboard: mr stop, then mr start');
  if (!res.ok) throw new CliError(`the daemon refused a sign-in code (${res.status})`);
  const { code } = await res.json();
  if (typeof code !== 'string' || !CODE_PATTERN.test(code)) throw new CliError('the daemon sent a malformed sign-in code');

  const url = `http://127.0.0.1:${port}/#code=${code}`;
  if (options.open === false) {
    ctx.print(url);
    ctx.print('one-time link, valid for a minute');
    return;
  }
  try {
    await ctx.openUrl(url);
    ctx.print(`opened http://127.0.0.1:${port} in your browser`);
  } catch (error) {
    ctx.print(`could not open a browser (${error.message}); open this one-time link within a minute:`);
    ctx.print(url);
  }
}

function register(program, ctx) {
  program
    .command('dashboard')
    .description('open the local web dashboard, signed in')
    .option('--no-open', 'print the one-time link instead of opening a browser')
    .action((options) => dashboard(ctx, options));
}

module.exports = { register, dashboard };
