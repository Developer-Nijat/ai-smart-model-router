'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { layout } = require('../src/layout');

describe('layout', () => {
  it('points at the repository when run from source', () => {
    const l = layout(undefined);
    expect(l.kind).toBe('source');
    expect(fs.existsSync(path.join(l.dataDir, 'models'))).toBe(true);
    expect(fs.existsSync(path.join(l.migrationsDir, '001_initial.sql'))).toBe(true);
    expect(fs.existsSync(l.serverBin)).toBe(true);
  });

  it('points inside the release package when its root is given', () => {
    const root = path.resolve('/opt/smart-model-router');
    expect(layout(root)).toEqual({
      kind: 'release',
      root,
      dataDir: path.join(root, 'data'),
      migrationsDir: path.join(root, 'migrations'),
      serverBin: path.join(root, 'bin', 'smr-server.js'),
      dashboardDir: path.join(root, 'dashboard'),
      modDir: path.join(root, 'claude-code-mod'),
    });
    expect(layout('').kind).toBe('source');
  });
});
