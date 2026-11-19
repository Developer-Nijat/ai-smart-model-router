'use strict';

const REDACTED = '[REDACTED]';
const OMITTED = '[OMITTED]';
const MAX_DEPTH = 8;

/**
 * Key words (after splitting camelCase / snake_case / kebab-case) whose values are credentials.
 * Numbers and booleans under such keys are kept: a count (`maxTokens`) cannot leak a secret.
 */
const SECRET_WORDS = new Set([
  'token',
  'tokens',
  'secret',
  'secrets',
  'password',
  'passwd',
  'passphrase',
  'authorization',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'bearer',
  'apikey',
]);
/** `key` is a secret only next to one of these words (`apiKey`, `privateKey`), not alone (`cacheKey`). */
const KEY_QUALIFIERS = new Set(['api', 'private', 'access', 'secret', 'signing', 'encryption']);

/** Key words whose values are user content: never logged by default (master prompt rule 14). */
const CONTENT_WORDS = new Set([
  'prompt',
  'prompts',
  'message',
  'messages',
  'content',
  'contents',
  'text',
  'input',
  'output',
  'completion',
  'body',
  'diff',
  'stdout',
  'stderr',
  'query',
  'transcript',
  'instruction',
  'instructions',
]);

/** Credential shapes that may appear inside free text. Order matters: specific before generic. */
const SECRET_VALUE = [
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/sk-(proj-)?[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/AIza[0-9A-Za-z_-]{20,}/g, REDACTED],
  [/github_pat_[A-Za-z0-9_]{20,}/g, REDACTED],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED],
  [/xox[abposr]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, REDACTED],
  [/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${REDACTED}`],
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi, `$1${REDACTED}@`],
  [/\b(api[_-]?key|access[_-]?token|token|secret|password|passwd)=([^\s&"']+)/gi, `$1=${REDACTED}`],
];

/**
 * Redacts credential shapes inside a string.
 * @param {string} value
 * @returns {string}
 */
function redactString(value) {
  return SECRET_VALUE.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

function keyWords(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function classifyKey(key) {
  const words = keyWords(key);
  const isSecret =
    words.some((word) => SECRET_WORDS.has(word)) ||
    (words.includes('key') && words.some((word) => KEY_QUALIFIERS.has(word)));
  if (isSecret) return 'secret';
  if (words.some((word) => CONTENT_WORDS.has(word))) return 'content';
  return 'plain';
}

function isHarmlessScalar(value) {
  return value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean';
}

/**
 * Returns a redacted, JSON-safe deep copy of `value`; the input is never modified.
 * Secrets become [REDACTED], user content becomes [OMITTED], cycles and excessive depth
 * are cut, and values JSON cannot hold (BigInt, functions, symbols, Map, Set, Date)
 * are converted. Never throws, even on hostile getters.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function redact(value) {
  return walk(value, 0, new WeakSet());
}

function walk(value, depth, ancestors) {
  switch (typeof value) {
    case 'string':
      return redactString(value);
    case 'bigint':
      return value.toString();
    case 'function':
      return '[Function]';
    case 'symbol':
      return value.toString();
    case 'object':
      break;
    default:
      return value;
  }
  if (value === null) return null;
  if (ancestors.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';

  ancestors.add(value);
  try {
    return walkObject(value, depth, ancestors);
  } catch {
    return '[Unserializable]';
  } finally {
    ancestors.delete(value);
  }
}

function walkObject(value, depth, ancestors) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(String(value.message)),
      ...(value.code !== undefined ? { code: walk(value.code, depth + 1, ancestors) } : {}),
    };
  }
  if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1, ancestors));
  if (value instanceof Set) return [...value].map((item) => walk(item, depth + 1, ancestors));
  const entries = value instanceof Map ? [...value].map(([k, v]) => [String(k), v]) : Object.entries(value);

  return Object.fromEntries(
    entries.map(([key, item]) => {
      const kind = classifyKey(key);
      if (kind === 'plain' || isHarmlessScalar(item)) return [key, walk(item, depth + 1, ancestors)];
      return [key, kind === 'secret' ? REDACTED : OMITTED];
    }),
  );
}

module.exports = { redact, redactString, REDACTED, OMITTED };
