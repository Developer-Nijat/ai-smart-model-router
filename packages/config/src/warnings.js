'use strict';

/**
 * Node 22 marks `node:sqlite` experimental and prints an ExperimentalWarning on every
 * start of `mr` and the server. Hide that one warning, and only it: every other warning
 * still reaches the default handler. Call before anything loads `node:sqlite`.
 *
 * @param {NodeJS.Process} [proc]
 * @returns {() => void} restores the original emitWarning
 */
function quietSqliteWarning(proc = process) {
  const original = proc.emitWarning;
  proc.emitWarning = function emitWarning(warning, ...args) {
    const text = typeof warning === 'string' ? warning : warning?.message;
    const type = typeof args[0] === 'string' ? args[0] : (args[0]?.type ?? warning?.name);
    if (type === 'ExperimentalWarning' && /sqlite/i.test(String(text))) return;
    return original.call(proc, warning, ...args);
  };
  return () => {
    proc.emitWarning = original;
  };
}

module.exports = { quietSqliteWarning };
