'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadRegistryData, loadRules, DEFAULT_DATA_DIR } = require('../src');
const { ConfigError } = require('@smr/shared');

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-data-'));
  fs.mkdirSync(path.join(dir, 'models'));
  fs.mkdirSync(path.join(dir, 'pricing'));
  fs.mkdirSync(path.join(dir, 'routing-rules'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const write = (rel, value) => fs.writeFileSync(path.join(dir, rel), typeof value === 'string' ? value : JSON.stringify(value));

describe('loadRegistryData', () => {
  it('merges every models and pricing file in name order', () => {
    write('models/b.json', { providers: [{ id: 'b' }], models: [{ id: 'b.1' }] });
    write('models/a.json', { providers: [{ id: 'a' }], models: [{ id: 'a.1' }] });
    write('pricing/p.json', [{ modelId: 'a.1' }]);
    write('models/ignored.txt', 'x');
    expect(loadRegistryData(dir)).toEqual({
      providers: [{ id: 'a' }, { id: 'b' }],
      models: [{ id: 'a.1' }, { id: 'b.1' }],
      pricing: [{ modelId: 'a.1' }],
    });
  });

  it('tolerates missing folders and keys', () => {
    write('models/empty.json', {});
    fs.rmSync(path.join(dir, 'pricing'), { recursive: true });
    expect(loadRegistryData(dir)).toEqual({ providers: [], models: [], pricing: [] });
  });

  it('reports broken files clearly', () => {
    write('models/bad.json', '{ nope');
    expect(() => loadRegistryData(dir)).toThrow(ConfigError);
    write('models/bad.json', { models: 'not a list' });
    expect(() => loadRegistryData(dir)).toThrow(/"models" must be an array/);
  });

  it('reads a file starting with a BOM', () => {
    const bom = String.fromCharCode(0xfeff);
    write('models/bom.json', `${bom}${JSON.stringify({ models: [{ id: 'x.y' }] })}`);
    expect(loadRegistryData(dir).models).toEqual([{ id: 'x.y' }]);
  });

  it('reads the shipped data folder', () => {
    expect(loadRegistryData().models.length).toBeGreaterThan(0);
    expect(fs.existsSync(DEFAULT_DATA_DIR)).toBe(true);
  });
});

describe('loadRules', () => {
  it('lets a user rule replace a shipped rule with the same id', () => {
    write('routing-rules/default.json', [{ id: 'a', v: 1 }, { id: 'b', v: 1 }]);
    const userFile = path.join(dir, 'user-rules.json');
    fs.writeFileSync(userFile, JSON.stringify([{ id: 'b', v: 2 }, { id: 'c', v: 2 }]));
    expect(loadRules({ dataDir: dir, userRulesFile: userFile })).toEqual([{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'c', v: 2 }]);
  });

  it('works with neither file present', () => {
    fs.rmSync(path.join(dir, 'routing-rules'), { recursive: true });
    expect(loadRules({ dataDir: dir, userRulesFile: path.join(dir, 'none.json') })).toEqual([]);
    expect(loadRules()).toEqual([]);
  });

  it('refuses a rules file that is not a list', () => {
    write('routing-rules/default.json', { id: 'a' });
    expect(() => loadRules({ dataDir: dir })).toThrow(/must be an array/);
  });

  it('wraps a read failure', () => {
    fs.mkdirSync(path.join(dir, 'models', 'dir.json'));
    expect(() => loadRegistryData(dir)).toThrow(/Cannot read data file/);
  });
});
