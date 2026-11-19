'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ConfigError } = require('@smr/shared');
const { layout } = require('./layout');

/** The data folder shipped with the program (`data/` in the repo or the release). */
const DEFAULT_DATA_DIR = layout().dataDir;

function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new ConfigError(`Cannot read data file ${file}: ${error.message}`, { file });
  }
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    throw new ConfigError(`Data file ${file} is not valid JSON: ${error.message}`, { file });
  }
}

function jsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => path.join(dir, name));
}

function expectArray(value, file, key) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ConfigError(`${file}: "${key}" must be an array`, { file });
  return value;
}

/**
 * Reads the registry data: `models/*.json` ({ providers, models }) and `pricing/*.json`
 * (arrays of price records). Shape only; createRegistry validates every record.
 *
 * @param {string} [dataDir]
 * @returns {{ providers: unknown[], models: unknown[], pricing: unknown[] }}
 */
function loadRegistryData(dataDir = DEFAULT_DATA_DIR) {
  const modelFiles = jsonFiles(path.join(dataDir, 'models')).map((file) => [file, readJson(file)]);
  const pricingFiles = jsonFiles(path.join(dataDir, 'pricing')).map((file) => [file, readJson(file)]);
  return {
    providers: modelFiles.flatMap(([file, json]) => expectArray(json.providers, file, 'providers')),
    models: modelFiles.flatMap(([file, json]) => expectArray(json.models, file, 'models')),
    pricing: pricingFiles.flatMap(([file, json]) => expectArray(json, file, '(root)')),
  };
}

/**
 * Reads routing rules: the shipped defaults, then the user's file if it exists.
 * A user rule with the same id replaces the shipped one.
 *
 * @param {{ dataDir?: string, userRulesFile?: string | null }} [options]
 * @returns {unknown[]}
 */
function loadRules(options = {}) {
  const shippedFile = path.join(options.dataDir ?? DEFAULT_DATA_DIR, 'routing-rules', 'default.json');
  const shipped = fs.existsSync(shippedFile) ? expectArray(readJson(shippedFile), shippedFile, '(root)') : [];
  const userFile = options.userRulesFile ?? null;
  const user = userFile && fs.existsSync(userFile) ? expectArray(readJson(userFile), userFile, '(root)') : [];
  const userIds = new Set(user.map((rule) => rule?.id));
  return [...shipped.filter((rule) => !userIds.has(rule?.id)), ...user];
}

module.exports = { loadRegistryData, loadRules, DEFAULT_DATA_DIR };
