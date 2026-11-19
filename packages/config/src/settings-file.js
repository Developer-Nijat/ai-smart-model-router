'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SettingsSchema, ConfigError, formatIssues } = require('@smr/shared');

/**
 * The default settings, as a fresh object each call.
 * @returns {import('zod').infer<typeof SettingsSchema>}
 */
function defaultSettings() {
  return SettingsSchema.parse({});
}

/**
 * Reads and validates the settings file. A missing file yields defaults;
 * a broken or invalid file is an error, never silently replaced.
 *
 * @param {string} file absolute path of config.json
 * @returns {import('zod').infer<typeof SettingsSchema>}
 */
function loadSettings(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return defaultSettings();
    throw new ConfigError(`Cannot read settings file ${file}: ${error.message}`, { file, cause: error.code });
  }

  let json;
  try {
    json = JSON.parse(stripBom(raw));
  } catch (error) {
    throw new ConfigError(`Settings file ${file} is not valid JSON: ${error.message}`, { file });
  }

  const result = SettingsSchema.safeParse(json);
  if (!result.success) {
    const issues = formatIssues(result.error);
    throw new ConfigError(`Settings file ${file} is invalid: ${issues.join('; ')}`, { file, issues });
  }
  return result.data;
}

/**
 * Validates and writes settings atomically: a temp file in the same folder, then rename,
 * so a crash mid-write never leaves a half-written config behind.
 *
 * @param {string} file absolute path of config.json
 * @param {unknown} settings
 * @returns {import('zod').infer<typeof SettingsSchema>} the settings as written
 */
function saveSettings(file, settings) {
  const result = SettingsSchema.safeParse(settings);
  if (!result.success) {
    const issues = formatIssues(result.error);
    throw new ConfigError(`Refusing to save invalid settings: ${issues.join('; ')}`, { file, issues });
  }

  writeJsonAtomic(file, result.data, 'settings file');
  return result.data;
}

/**
 * Writes JSON atomically: a temp file in the same folder, then rename. The caller
 * validates first; this only makes sure the file is never half written.
 *
 * @param {string} file
 * @param {unknown} value
 * @param {string} [what] how errors name the file
 */
function writeJsonAtomic(file, value, what = 'file') {
  const dir = path.dirname(file);
  const temp = path.join(dir, `.${path.basename(file)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    writeDurably(temp, `${JSON.stringify(value, null, 2)}\n`);
    renameWithRetry(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw new ConfigError(`Cannot write ${what} ${file}: ${error.message}`, { file, cause: error.code });
  }
}

/**
 * Writes and fsyncs, so a power loss after the rename cannot leave an empty file.
 * `mode` restricts the file to its owner on POSIX; on Windows the user profile ACL applies.
 */
function writeDurably(file, text) {
  const fd = fs.openSync(file, 'w', 0o600);
  try {
    fs.writeSync(fd, text, null, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_ATTEMPTS = 5;
const RENAME_WAIT_MS = 20;

/**
 * On Windows a rename over a file another process (an editor, an antivirus scan)
 * holds open fails briefly with EPERM/EBUSY; retry a few times before giving up.
 */
function renameWithRetry(from, to, rename = fs.renameSync) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      if (!RETRYABLE.has(error.code) || attempt >= RENAME_ATTEMPTS) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RENAME_WAIT_MS * attempt);
    }
  }
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

module.exports = { defaultSettings, loadSettings, saveSettings, writeJsonAtomic, renameWithRetry };
