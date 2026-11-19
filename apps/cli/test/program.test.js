'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createProgram, version } = require('../src/program');

function runProgram(args) {
  const out = [];
  const program = createProgram({ writeOut: (text) => out.push(text), writeErr: (text) => out.push(text) });
  program.exitOverride();
  let exitCode = 0;
  try {
    program.parse(args, { from: 'user' });
  } catch (error) {
    exitCode = error.exitCode;
  }
  return { output: out.join(''), exitCode };
}

describe('mr', () => {
  it('prints its version', () => {
    expect(runProgram(['--version'])).toEqual({ output: `${version}\n`, exitCode: 0 });
  });

  it('prints help naming the command', () => {
    const { output } = runProgram(['--help']);
    expect(output).toMatch(/Usage: mr/);
  });

  it('fails on an unknown option', () => {
    expect(runProgram(['--nope']).exitCode).toBe(1);
  });

  it('runs as a real process through bin/mr.js', () => {
    const bin = path.join(__dirname, '..', 'bin', 'mr.js');
    expect(execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf8' }).trim()).toBe(version);
  });
});
