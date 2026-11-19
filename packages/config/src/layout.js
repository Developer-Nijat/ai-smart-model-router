'use strict';

const path = require('node:path');

/**
 * Where the program's own files are: the shipped data, migrations, the daemon entry,
 * the built dashboard and the built Claude Code mod.
 *
 * Two layouts exist:
 * - `source`: this repository (npm workspaces);
 * - `release`: the self-contained package `npm run release` builds. Its bundles set
 *   `globalThis.__SMR_RELEASE_ROOT__` (in an esbuild banner) to the package folder.
 *
 * Everything that needs one of these paths asks here, so moving to the release
 * layout changes this file only.
 */
// Read once, when this module loads (the release banner sets it before any code runs):
// nothing that runs later can redirect where the program loads its own files from.
const RELEASE_ROOT = globalThis.__SMR_RELEASE_ROOT__;

function layout(root = RELEASE_ROOT) {
  if (typeof root === 'string' && root.length > 0) {
    return Object.freeze({
      kind: 'release',
      root,
      dataDir: path.join(root, 'data'),
      migrationsDir: path.join(root, 'migrations'),
      serverBin: path.join(root, 'bin', 'smr-server.js'),
      dashboardDir: path.join(root, 'dashboard'),
      modDir: path.join(root, 'claude-code-mod'),
    });
  }
  const repo = path.resolve(__dirname, '..', '..', '..');
  return Object.freeze({
    kind: 'source',
    root: repo,
    dataDir: path.join(repo, 'data'),
    migrationsDir: path.join(repo, 'packages', 'storage', 'src', 'migrations'),
    serverBin: path.join(repo, 'apps', 'server', 'bin', 'smr-server.js'),
    dashboardDir: path.join(repo, 'apps', 'dashboard', 'dist'),
    modDir: path.join(repo, 'dist', 'claude-code-mod'),
  });
}

module.exports = { layout };
