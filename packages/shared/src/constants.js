'use strict';

/** Reasoning effort levels, in ascending order. Matches Claude Code's levels. */
const EFFORT_LEVELS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);

/** shadow: recommend only (default, ADR-006); auto: apply; off: router disabled. */
const ROUTING_MODES = Object.freeze(['shadow', 'auto', 'off']);

/** Where task text may go for classification (ADR-007). local-only is the default. */
const PRIVACY_MODES = Object.freeze(['local-only', 'local-ai', 'cloud-ai', 'hybrid']);

/** Who may run the optional AI classifier. agent-session uses the coding agent's own session. */
const CLASSIFIER_PROVIDERS = Object.freeze([
  'agent-session',
  'ollama',
  'anthropic-api',
  'openai-api',
  'google-api',
]);

const TASK_TYPES = Object.freeze([
  'bug_fix',
  'feature',
  'refactor',
  'test',
  'docs',
  'analysis',
  'architecture',
  'security',
  'ui',
  'config',
  'question',
  'other',
]);

const LEVELS = Object.freeze(['low', 'medium', 'high']);

const SCOPES = Object.freeze(['single_file', 'multi_file', 'multi_module', 'multi_service']);

/** Precedence order: manual beats rule beats everything automatic. */
const DECISION_SOURCES = Object.freeze([
  'manual',
  'rule',
  'classifier-rules',
  'classifier-ai',
  'sticky',
  'default',
  'fallback',
]);

/**
 * recommended: shadow mode, nothing changed. applied: the adapter confirmed the change.
 * unsupported: the agent cannot apply it. failed: the adapter tried and failed.
 * skipped: router off or nothing to do.
 */
const DECISION_STATUSES = Object.freeze(['recommended', 'applied', 'unsupported', 'failed', 'skipped']);

const MODEL_STATUSES = Object.freeze(['enabled', 'disabled', 'deprecated']);

const LOG_LEVELS = Object.freeze(['debug', 'info', 'warn', 'error']);

/** The local API never binds beyond loopback. */
const LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', '::1']);

module.exports = {
  EFFORT_LEVELS,
  ROUTING_MODES,
  PRIVACY_MODES,
  CLASSIFIER_PROVIDERS,
  TASK_TYPES,
  LEVELS,
  SCOPES,
  DECISION_SOURCES,
  DECISION_STATUSES,
  MODEL_STATUSES,
  LOG_LEVELS,
  LOOPBACK_HOSTS,
};
