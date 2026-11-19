#!/usr/bin/env node
'use strict';

// Before anything loads node:sqlite.
require('@smr/config').quietSqliteWarning();

const { startServer } = require('../src/run');

const portArg = process.argv.indexOf('--port');
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : undefined;
if (port !== undefined && (!Number.isInteger(port) || port < 1024 || port > 65535)) {
  process.stderr.write('smr-server: --port must be 1024-65535\n');
  process.exit(2);
}
const say = (text) => process.stderr.write(`smr-server: ${text}\n`);

let stop = () => process.exit(0);

startServer({ port, logToFile: process.argv.includes('--log-file'), onShutdown: () => stop('shutdown request') }).then(
  (server) => {
    stop = (why) => {
      say(`stopping (${why})`);
      server.close().then(
        () => process.exit(0),
        (error) => {
          say(`close failed: ${error.message}`);
          process.exit(1);
        },
      );
    };
    process.on('SIGINT', () => stop('SIGINT'));
    process.on('SIGTERM', () => stop('SIGTERM'));
  },
  (error) => {
    say(error.message);
    process.exitCode = 1;
  },
);

process.on('exit', (code) => {
  if (code !== 0) say(`exit ${code}`);
});
