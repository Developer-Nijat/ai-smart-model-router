'use strict';

const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { loadRegistryData, loadRules } = require('@smr/config');
const { createRouter } = require('../src/router');

const PACKAGE_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PACKAGE_DIR, '..', '..');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'dist', 'claude-code-mod');
const NODE_BUILTIN = /(?:require\(|from\s*)["'](?:node:)?(?:fs|path|os|crypto|child_process|net|http|https|url|worker_threads)["']/;

/**
 * Builds the Claude Code mod folder: the mod sources (`mod-src/`) plus one ES module,
 * `lib/router.mjs`, holding the router, the core and the registry data and rules
 * (ADR-003). The result is loaded with `claude --plugin-dir <outDir>`.
 *
 * `withTests` also copies the engine-kit tests (`mod-test/`) for `claude plugin test`.
 *
 * @param {{ outDir?: string, dataDir?: string, withTests?: boolean }} [options]
 * @returns {Promise<{ outDir: string, bundleBytes: number }>}
 */
async function build(options = {}) {
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;
  const data = loadRegistryData(options.dataDir);
  const rules = loadRules({ dataDir: options.dataDir });
  // Fail the build, not the session, on invalid data.
  createRouter({ data, rules });

  // Empty the folder rather than remove it: a shell or editor may hold it open (Windows).
  fs.mkdirSync(outDir, { recursive: true });
  for (const entry of fs.readdirSync(outDir)) fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });
  fs.cpSync(path.join(PACKAGE_DIR, 'mod-src'), outDir, { recursive: true });
  if (options.withTests) fs.cpSync(path.join(PACKAGE_DIR, 'mod-test'), path.join(outDir, 'test'), { recursive: true });

  const outfile = path.join(outDir, 'lib', 'router.mjs');
  await esbuild.build({
    stdin: {
      contents: [
        "import smr from './src/index.js';",
        `export default { ...smr, DATA: ${JSON.stringify(data)}, RULES: ${JSON.stringify(rules)} };`,
      ].join('\n'),
      resolveDir: PACKAGE_DIR,
      sourcefile: 'mod-entry.js',
      loader: 'js',
    },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['main', 'module'],
    legalComments: 'none',
    // The mod loader reads modules up to 1 MiB; zod alone is most of the bundle.
    minify: true,
    outfile,
    logLevel: 'silent',
  });

  const bundle = fs.readFileSync(outfile, 'utf8');
  if (NODE_BUILTIN.test(bundle)) throw new Error('mod bundle pulls in a Node built-in module; the mod runtime has none');
  return { outDir, bundleBytes: Buffer.byteLength(bundle) };
}

module.exports = { build, DEFAULT_OUT_DIR };

if (require.main === module) {
  const outAt = process.argv.indexOf('--out');
  const outDir = outAt > 0 && process.argv[outAt + 1] ? path.resolve(process.argv[outAt + 1]) : undefined;
  build({ withTests: process.argv.includes('--with-tests'), outDir }).then(
    ({ outDir, bundleBytes }) => process.stdout.write(`built ${outDir} (router.mjs ${Math.round(bundleBytes / 1024)} KB)\n`),
    (error) => {
      process.stderr.write(`mod build failed: ${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
