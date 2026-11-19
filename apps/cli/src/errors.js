'use strict';

/** A failure to report to the person as is: no stack, exit code 1. */
class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

module.exports = { CliError };
