'use strict';

const { BaseAgentAdapter, OPERATION_CAPABILITY } = require('./base-adapter');
const { ok, unsupported, failed } = require('./result');
const { ClaudeCodeAdapter, CLAUDE_CODE_CAPABILITIES, MIN_CLAUDE_CODE_VERSION } = require('./claude-code');
const { DetectOnlyAdapter, CodexAdapter, GeminiCliAdapter } = require('./detect-only');
const { runVersion, parseVersion, compareVersions, detectCli } = require('./detect');
const { detectAgents } = require('./agents');

module.exports = {
  BaseAgentAdapter,
  OPERATION_CAPABILITY,
  ok,
  unsupported,
  failed,
  ClaudeCodeAdapter,
  CLAUDE_CODE_CAPABILITIES,
  MIN_CLAUDE_CODE_VERSION,
  DetectOnlyAdapter,
  CodexAdapter,
  GeminiCliAdapter,
  runVersion,
  parseVersion,
  compareVersions,
  detectCli,
  detectAgents,
};
