'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { build } = require('../../packages/claude-code-mod/scripts/build');

const MOD_FILE_LIMIT = 1024 * 1024;

/** ADR-003: the mod folder the build makes loads in Claude Code and routes with the shipped data. */
describe('Claude Code mod build', () => {
  let outDir;

  beforeAll(async () => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-mod-'));
    await build({ outDir });
  });

  afterAll(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('writes the plugin manifest, hooks and the bundle, without tests', () => {
    for (const file of ['.claude-plugin/plugin.json', 'hooks/hooks.json', 'hooks/register.tsx', 'lib/router.mjs', 'lib/router.d.mts', 'types/index.d.ts']) {
      expect(fs.existsSync(path.join(outDir, file))).toBe(true);
    }
    expect(fs.existsSync(path.join(outDir, 'test'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(outDir, '.claude-plugin', 'plugin.json'), 'utf8')).name).toBe('smart-model-router');
  });

  it('keeps the bundle under the mod loader 1 MiB file limit, with no Node built-in or build path', () => {
    const bundle = fs.readFileSync(path.join(outDir, 'lib', 'router.mjs'), 'utf8');
    expect(Buffer.byteLength(bundle)).toBeLessThan(MOD_FILE_LIMIT);
    expect(bundle).not.toMatch(/from ["']node:/);
    expect(bundle).not.toContain(os.homedir());
  });

  it('routes with the bundled data', async () => {
    const mod = await import(pathToFileURL(path.join(outDir, 'lib', 'router.mjs')).href);
    const smr = mod.default;
    const router = smr.createRouter({ data: smr.DATA, rules: smr.RULES });
    const { settings } = smr.settingsFromOptions({ defaultMode: 'auto' });
    const state = router.newSession('s');
    const text = "Fix the typo in the word 'helo'";
    const classified = await router.classify({ text, state, settings });
    const plan = router.decideTurn({ state, settings, text, classified, ids: { decisionId: 'd', turnId: 't' }, createdAt: '2026-11-19T10:00:00.000Z', observedModel: 'opus' });
    expect(plan).toMatchObject({ shouldApply: true, agentModel: 'haiku', agentEffort: 'low' });
  });
});
