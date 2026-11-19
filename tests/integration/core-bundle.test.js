'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');

const ENTRY = path.join(__dirname, '..', '..', 'packages', 'core', 'src', 'index.js');

/**
 * ADR-003: the Claude Code mod loads the core as one ES module with no Node built-ins.
 * Bundle it the way the mod build will and run a decision through the bundle.
 */
describe('core as an ESM bundle (ADR-003)', () => {
  let dir;
  let bundle;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-bundle-'));
    const outfile = path.join(dir, 'core.mjs');
    await esbuild.build({
      entryPoints: [ENTRY],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      mainFields: ['main', 'module'],
      legalComments: 'none',
      outfile,
      logLevel: 'silent',
    });
    bundle = fs.readFileSync(outfile, 'utf8');
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('pulls in no Node built-in module', () => {
    expect(bundle).not.toMatch(/require\(["'](node:)?(fs|path|os|crypto|child_process|net|http)["']\)/);
    expect(bundle).not.toMatch(/from ["']node:/);
  });

  it('contains no absolute path of the build machine', () => {
    expect(bundle).not.toContain(os.homedir());
  });

  it('runs a routing decision', async () => {
    const mod = await import(pathToFileURL(path.join(dir, 'core.mjs')).href);
    const core = mod.default ?? mod;
    const registry = core.createRegistry({
      providers: [{ id: 'acme', displayName: 'Acme', kind: 'cloud' }],
      models: [
        { id: 'acme.small', provider: 'acme', displayName: 'S', tier: 1, agentModelIds: { 'claude-code': 'small' } },
        { id: 'acme.big', provider: 'acme', displayName: 'B', tier: 3, agentModelIds: { 'claude-code': 'big' } },
      ],
    });
    const { decision } = core.decide({
      ids: { decisionId: 'd' },
      createdAt: '2026-11-19T10:00:00.000Z',
      agent: { id: 'claude-code', capabilities: { turnLevelRouting: true } },
      settings: {
        routing: { mode: 'auto', sticky: { enabled: true, minScoreGain: 0.15 }, weights: { quality: 1, cost: 0.3, latency: 0.1, transition: 0.5 } },
        classifier: { enabled: false, provider: 'agent-session', confidenceThreshold: 0.7 },
        privacy: { mode: 'local-only' },
      },
      registry,
      session: core.createSessionState({ sessionId: 's', agentId: 'claude-code' }),
      text: 'Audit the auth flow for injection vulnerabilities',
    });
    expect(decision.selection.model).toBe('acme.big');
  });
});
