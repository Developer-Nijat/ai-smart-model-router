#!/usr/bin/env node
'use strict';

/**
 * Builds the self-contained release package (Phase 6):
 *
 *   release/smart-model-router/
 *     bin/mr.js, bin/smr-server.js   CLI and daemon, bundled (no node_modules needed)
 *     data/                          model registry, prices, default rules, benchmark set
 *     migrations/                    SQLite migrations
 *     dashboard/                     built web dashboard
 *     claude-code-mod/               built Claude Code mod
 *     .claude-plugin/marketplace.json  local marketplace listing the mod
 *     package.json, README.md
 *   release/smart-model-router-<version>.tgz   (npm pack)
 *
 * Install: npm install -g release/smart-model-router-<version>.tgz
 * The bundles set globalThis.__SMR_RELEASE_ROOT__ so @smr/config's layout() finds the
 * files above instead of the repository's.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');
const { build: buildMod } = require('../packages/claude-code-mod/scripts/build');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'release');
const PKG_DIR = path.join(OUT_DIR, 'smart-model-router');
const { version, engines } = require('../package.json');

const BANNER = [
  '#!/usr/bin/env node',
  "globalThis.__SMR_RELEASE_ROOT__ = require('node:path').resolve(__dirname, '..');",
].join('\n');

function copyDir(from, to, filter = () => true) {
  fs.cpSync(from, to, { recursive: true, filter: (src) => filter(src) });
}

/** cmd.exe joins arguments unquoted: quote each so a path with spaces stays one argument. */
const forShell = (arg) => (/^[\w.:\\/=-]+$/.test(arg) ? arg : `"${String(arg).replace(/"/g, '""')}"`);

function npm(args, cwd) {
  // npm is a .cmd on Windows: run it through the shell there, each argument quoted.
  const win = process.platform === 'win32';
  return execFileSync(win ? 'npm.cmd' : 'npm', win ? args.map(forShell) : args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], shell: win })
    .toString()
    .trim();
}

async function bundle(entry, outfile) {
  await esbuild.build({
    entryPoints: [path.join(ROOT, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    banner: { js: BANNER },
    legalComments: 'none',
    logLevel: 'warning',
  });
  // esbuild keeps the entry's own hashbang just below the banner: drop that second copy
  // (only there, never a line deeper in the bundle).
  const text = fs.readFileSync(outfile, 'utf8').split('\n');
  const head = text.slice(1, 4).filter((line) => !line.startsWith('#!'));
  const cleaned = [text[0], ...head, ...text.slice(4)].join('\n');
  fs.writeFileSync(outfile, cleaned, { mode: 0o755 });
}

function packageJson() {
  return {
    name: 'smart-model-router',
    version,
    description: 'Smart Model Router: picks the model and reasoning effort for each coding-agent turn. Local CLI, daemon and dashboard.',
    license: 'MIT',
    private: true,
    bin: { mr: 'bin/mr.js' },
    engines,
    os: ['win32', 'linux', 'darwin'],
    files: ['bin/', 'data/', 'migrations/', 'dashboard/', 'claude-code-mod/', '.claude-plugin/', 'README.md'],
  };
}

const MARKETPLACE = {
  name: 'smart-model-router-local',
  owner: { name: 'Smart Model Router' },
  plugins: [{ name: 'smart-model-router', source: './claude-code-mod' }],
};

async function release({ pack = true } = {}) {
  const cliVersion = require('../apps/cli/package.json').version;
  if (cliVersion !== version) throw new Error(`apps/cli is ${cliVersion} but the package is ${version}: give both the same version`);
  fs.rmSync(PKG_DIR, { recursive: true, force: true });
  // Old tarballs: the smoke test takes the only one there is.
  if (fs.existsSync(OUT_DIR)) for (const name of fs.readdirSync(OUT_DIR)) if (name.endsWith('.tgz')) fs.rmSync(path.join(OUT_DIR, name));
  fs.mkdirSync(path.join(PKG_DIR, 'bin'), { recursive: true });

  npm(['run', 'build:dashboard'], ROOT);
  await buildMod();

  await bundle('apps/cli/bin/mr.js', path.join(PKG_DIR, 'bin', 'mr.js'));
  await bundle('apps/server/bin/smr-server.js', path.join(PKG_DIR, 'bin', 'smr-server.js'));

  copyDir(path.join(ROOT, 'data'), path.join(PKG_DIR, 'data'));
  copyDir(path.join(ROOT, 'packages', 'storage', 'src', 'migrations'), path.join(PKG_DIR, 'migrations'), (src) => fs.statSync(src).isDirectory() || src.endsWith('.sql'));
  copyDir(path.join(ROOT, 'apps', 'dashboard', 'dist'), path.join(PKG_DIR, 'dashboard'));
  // The mod without its engine-written editor types: those belong to a working copy.
  copyDir(path.join(ROOT, 'dist', 'claude-code-mod'), path.join(PKG_DIR, 'claude-code-mod'), (src) => !src.includes(`${path.sep}.claude-plugin${path.sep}types`));

  fs.mkdirSync(path.join(PKG_DIR, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(PKG_DIR, '.claude-plugin', 'marketplace.json'), `${JSON.stringify(MARKETPLACE, null, 2)}\n`);
  fs.writeFileSync(path.join(PKG_DIR, 'package.json'), `${JSON.stringify(packageJson(), null, 2)}\n`);
  fs.copyFileSync(path.join(ROOT, 'docs', 'release-readme.md'), path.join(PKG_DIR, 'README.md'));

  if (!pack) return { dir: PKG_DIR, tarball: null };
  const tarball = path.join(OUT_DIR, npm(['pack', '--silent', '--pack-destination', OUT_DIR], PKG_DIR).split('\n').pop());
  return { dir: PKG_DIR, tarball };
}

if (require.main === module) {
  release({ pack: !process.argv.includes('--no-pack') }).then(
    ({ dir, tarball }) => process.stdout.write(`release: ${dir}\n${tarball ? `package: ${tarball}\n` : ''}`),
    (error) => {
      process.stderr.write(`release failed: ${error.message}\n`);
      process.exitCode = 1;
    },
  );
}

module.exports = { release, packageJson, MARKETPLACE, forShell };
