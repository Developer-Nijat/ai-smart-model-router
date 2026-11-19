'use strict';

const { resolvePaths, APP_DIR } = require('./paths');
const { defaultSettings, loadSettings, saveSettings, writeJsonAtomic } = require('./settings-file');
const { loadRegistryData, loadRules, DEFAULT_DATA_DIR } = require('./data-files');
const { readToken, ensureToken, tokensMatch, healthProof, TOKEN_PATTERN, NONCE_PATTERN } = require('./token');
const { quietSqliteWarning } = require('./warnings');
const { layout } = require('./layout');
const { aclReport, restrictToOwner, windowsAccount } = require('./winacl');

module.exports = {
  resolvePaths,
  APP_DIR,
  defaultSettings,
  loadSettings,
  saveSettings,
  writeJsonAtomic,
  loadRegistryData,
  loadRules,
  DEFAULT_DATA_DIR,
  readToken,
  ensureToken,
  tokensMatch,
  healthProof,
  TOKEN_PATTERN,
  NONCE_PATTERN,
  quietSqliteWarning,
  layout,
  aclReport,
  restrictToOwner,
  windowsAccount,
};
