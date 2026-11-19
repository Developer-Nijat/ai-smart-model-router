'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolvePaths, defaultSettings, loadSettings, saveSettings } = require('../src');
const { renameWithRetry } = require('../src/settings-file');
const { ConfigError } = require('@smr/shared');

describe('resolvePaths', () => {
  it('keeps config in Roaming and the database and logs in Local on Windows', () => {
    const paths = resolvePaths({
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming', LOCALAPPDATA: 'D:\\Local' },
      homedir: 'C:\\Users\\a',
    });
    expect(paths).toEqual({
      configDir: 'C:\\Users\\a\\AppData\\Roaming\\smart-model-router',
      configFile: 'C:\\Users\\a\\AppData\\Roaming\\smart-model-router\\config.json',
      dataDir: 'D:\\Local\\smart-model-router',
      dbFile: 'D:\\Local\\smart-model-router\\smr.db',
      logDir: 'D:\\Local\\smart-model-router\\logs',
      rulesFile: 'C:\\Users\\a\\AppData\\Roaming\\smart-model-router\\rules.json',
      tokenFile: 'C:\\Users\\a\\AppData\\Roaming\\smart-model-router\\token',
      pidFile: 'D:\\Local\\smart-model-router\\server.pid',
      serverLogFile: 'D:\\Local\\smart-model-router\\logs\\server.log',
    });
  });

  it('falls back to the home folder on Windows without APPDATA/LOCALAPPDATA', () => {
    const paths = resolvePaths({ platform: 'win32', env: {}, homedir: 'C:\\Users\\a' });
    expect(paths.configDir).toBe('C:\\Users\\a\\AppData\\Roaming\\smart-model-router');
    expect(paths.dbFile).toBe('C:\\Users\\a\\AppData\\Local\\smart-model-router\\smr.db');
  });

  it('uses Application Support and Library/Logs on macOS', () => {
    const paths = resolvePaths({ platform: 'darwin', env: {}, homedir: '/Users/a' });
    expect(paths.configFile).toBe('/Users/a/Library/Application Support/smart-model-router/config.json');
    expect(paths.dbFile).toBe('/Users/a/Library/Application Support/smart-model-router/smr.db');
    expect(paths.logDir).toBe('/Users/a/Library/Logs/smart-model-router');
  });

  it('uses the XDG config, data and state homes on Linux', () => {
    const env = { XDG_CONFIG_HOME: '/c', XDG_DATA_HOME: '/d', XDG_STATE_HOME: '/s' };
    expect(resolvePaths({ platform: 'linux', env, homedir: '/home/a' })).toEqual({
      configDir: '/c/smart-model-router',
      configFile: '/c/smart-model-router/config.json',
      dataDir: '/d/smart-model-router',
      dbFile: '/d/smart-model-router/smr.db',
      logDir: '/s/smart-model-router/logs',
      rulesFile: '/c/smart-model-router/rules.json',
      tokenFile: '/c/smart-model-router/token',
      pidFile: '/d/smart-model-router/server.pid',
      serverLogFile: '/s/smart-model-router/logs/server.log',
    });
  });

  it('falls back to ~/.config, ~/.local/share and ~/.local/state, ignoring relative XDG values', () => {
    const paths = resolvePaths({ platform: 'linux', env: { XDG_DATA_HOME: 'relative/dir' }, homedir: '/home/a' });
    expect(paths.configDir).toBe('/home/a/.config/smart-model-router');
    expect(paths.dbFile).toBe('/home/a/.local/share/smart-model-router/smr.db');
    expect(paths.logDir).toBe('/home/a/.local/state/smart-model-router/logs');
  });

  it('lets SMR_HOME put everything in one folder', () => {
    expect(resolvePaths({ platform: 'linux', env: { SMR_HOME: '/data/smr' }, homedir: '/home/a' })).toEqual({
      configDir: '/data/smr',
      configFile: '/data/smr/config.json',
      dataDir: '/data/smr',
      dbFile: '/data/smr/smr.db',
      logDir: '/data/smr/logs',
      rulesFile: '/data/smr/rules.json',
      tokenFile: '/data/smr/token',
      pidFile: '/data/smr/server.pid',
      serverLogFile: '/data/smr/logs/server.log',
    });
  });

  it('returns a frozen object and works with real process defaults', () => {
    const paths = resolvePaths();
    expect(Object.isFrozen(paths)).toBe(true);
    expect(path.isAbsolute(paths.dbFile)).toBe(true);
  });
});

describe('renameWithRetry', () => {
  function busy(code, failures) {
    let calls = 0;
    const rename = () => {
      calls += 1;
      if (calls <= failures) throw Object.assign(new Error(code), { code });
    };
    return { rename, calls: () => calls };
  }

  it('retries a transient Windows lock and then succeeds', () => {
    const fake = busy('EPERM', 2);
    renameWithRetry('a', 'b', fake.rename);
    expect(fake.calls()).toBe(3);
  });

  it('gives up after a few attempts', () => {
    const fake = busy('EBUSY', 99);
    expect(() => renameWithRetry('a', 'b', fake.rename)).toThrow('EBUSY');
    expect(fake.calls()).toBe(5);
  });

  it('does not retry other errors', () => {
    const fake = busy('ENOENT', 1);
    expect(() => renameWithRetry('a', 'b', fake.rename)).toThrow('ENOENT');
    expect(fake.calls()).toBe(1);
  });
});

describe('settings file', () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-config-'));
    file = path.join(dir, 'nested', 'config.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns defaults when the file does not exist', () => {
    expect(loadSettings(file)).toEqual(defaultSettings());
  });

  it('saves atomically and loads back the same settings', () => {
    const saved = saveSettings(file, { routing: { mode: 'auto' } });
    expect(saved.routing.mode).toBe('auto');
    expect(loadSettings(file)).toEqual(saved);
    expect(fs.readdirSync(path.dirname(file))).toEqual(['config.json']);
  });

  it('reads a file that starts with a UTF-8 BOM', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '\uFEFF{"logging":{"level":"debug"}}');
    expect(loadSettings(file).logging.level).toBe('debug');
  });

  it('refuses broken JSON instead of resetting it', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ not json');
    expect(() => loadSettings(file)).toThrow(ConfigError);
    expect(fs.readFileSync(file, 'utf8')).toBe('{ not json');
  });

  it('reports every invalid field', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ server: { host: '0.0.0.0', port: 1 } }));
    let caught;
    try {
      loadSettings(file);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect(caught.details.issues).toHaveLength(2);
  });

  it('refuses to save invalid settings and leaves no file', () => {
    expect(() => saveSettings(file, { routing: { mode: 'yolo' } })).toThrow(ConfigError);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('wraps a read failure other than a missing file', () => {
    fs.mkdirSync(file, { recursive: true });
    expect(() => loadSettings(file)).toThrow(/Cannot read settings file/);
  });

  it('wraps a write failure and cleans up the temp file', () => {
    fs.mkdirSync(file, { recursive: true });
    expect(() => saveSettings(file, {})).toThrow(/Cannot write settings file/);
    expect(fs.readdirSync(path.dirname(file))).toEqual(['config.json']);
  });
});
