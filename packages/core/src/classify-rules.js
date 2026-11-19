'use strict';

const { clamp, round } = require('./util');

/**
 * A word-start match that also works for Azerbaijani letters (ə, ş, ç, ğ, ı, ö, ü),
 * where `\b` does not: the stem must not follow another letter or digit.
 */
function term(source) {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})`, 'iu');
}

/** Ends a stem at a word boundary that also works for Azerbaijani letters. */
const END = '(?![\\p{L}\\p{N}])';

/** Task-type signals in English and Azerbaijani. Weight 1 each unless stated. */
const TASK_SIGNALS = Object.freeze({
  bug_fix: [
    'fix', 'bug', 'error', 'exception', 'crash', 'broken', 'fail', 'stack ?trace', 'traceback', 'regression',
    'düzəlt', 'xəta', 'səhv', 'işləmir', 'çökür', 'problem',
  ],
  feature: [
    `add${END}`, 'adding', 'implement', 'create', 'build', 'new feature', 'endpoint', 'support for',
    'əlavə et', 'yarat', 'implementasiya', 'yeni funksiya',
  ],
  refactor: ['refactor', 'clean ?up', 'restructure', 'rename', 'extract', 'simplif', 'dedup', 'refaktor', 'təmizlə', 'sadələşdir'],
  test: [`tests?${END}`, `specs?${END}`, 'coverage', 'unit test', 'e2e', 'vitest', 'jest', 'test yaz', 'testlər'],
  docs: ['readme', 'document', `docs${END}`, 'jsdoc', 'changelog', 'comment', 'sənəd', 'dokument', 'şərh'],
  analysis: ['analy', 'investigate', 'review', 'audit', 'compare', 'evaluate', 'profiling', `profil${END}`, 'analiz', 'araşdır', 'müqayisə', 'qiymətləndir'],
  architecture: [
    'architect', 'system design', 'design the', 'scalab', 'microservice', 'monorepo', 'data model', 'schema design',
    'arxitektura', 'sistem dizayn', 'struktur',
  ],
  security: [
    'security', 'vulnerab', 'xss', 'csrf', 'injection', 'owasp', 'secret', 'permission', 'encrypt',
    `auth(?:n|entication|orization|orize|z)?${END}`, 'sanitiz', 'təhlükəsizlik', 'zəiflik', 'icazə', 'autentifikasiya', 'avtorizasiya',
  ],
  ui: [
    'css', 'style', 'layout', 'button', `ui${END}`, `ux${END}`, 'component', 'tailwind', 'responsive',
    'color', 'colour', 'rəng', 'düymə', 'səhifə', 'görünüş',
  ],
  config: [
    'config', `env${END}`, '\\.env', 'docker', `ci${END}`, 'ci/cd', 'pipeline', 'yaml', 'eslint', 'deploy',
    'package\\.json', 'konfiq', 'quraşdır',
  ],
  question: [`(?:what|how|why|which)${END}`, 'explain', 'nədir', 'necə', 'niyə', 'hansı', 'izah et'],
});

const QUESTION_WEIGHT = 0.6;

const COMPILED = Object.freeze(
  Object.entries(TASK_SIGNALS).map(([type, sources]) => [type, sources.map((source) => term(source))]),
);

/** Starting complexity by task type: a prior, adjusted by the modifiers below. */
const BASE_COMPLEXITY = Object.freeze({
  question: 0.2,
  docs: 0.25,
  ui: 0.3,
  config: 0.35,
  test: 0.4,
  other: 0.4,
  bug_fix: 0.45,
  feature: 0.5,
  refactor: 0.55,
  analysis: 0.55,
  security: 0.7,
  architecture: 0.8,
});

const HARD = term(
  `race condition|deadlock|concurren|perf(?:orman(?:ce|t))?${END}|memory leak|distributed|migrat|zero[- ]downtime|transaction|` +
    'optimi|algorithm|performans|yaddaş sızması|miqrasiya|optimallaşdır',
);
/** Words that make the work itself trivial, whatever is being done. */
const TRIVIAL = term(
  'typo|quick fix|one[- ]line|trivial|spelling|' +
    'bir sətir|yazım səhv|hərf səhv|orfoqrafi',
);
/** Size words: trivial when they describe the change ("a small fix"), not the thing built. */
const SIZE = term('small|minor|simple|tiny|kiçik|sadə');
/**
 * "Create a small Express API": the size word describes what gets built, which can still be
 * real work. English puts the verb first, Azerbaijani last ("kiçik bir API yarat").
 */
const CHANGE_NOUN = String.raw`(?!\s+(?:change|fix|tweak|edit|update|adjustment|correction|dəyişiklik|düzəliş)\p{L}*)`;
const BUILDS_SIZED = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:create|build|implement|write|make|set up|scaffold|develop|generate)${END}(?:\s+(?:a|an|the|me))?\s+(?:small|simple|minor|tiny|basic)${END}${CHANGE_NOUN}|` +
    String.raw`(?<![\p{L}\p{N}])(?:kiçik|sadə)${END}${CHANGE_NOUN}(?:\s+[\p{L}-]+){1,4}\s+(?:yarat|qur|yaz|hazırla)\p{L}*\s*[.!]*\s*$`,
  'iu',
);
const SCOPE_NOUN = '(?:codebase|project|repo|repository|app|application|services|modules|packages|files)';
const WIDE = term(
  `all files|(?:entire|whole) ${SCOPE_NOUN}|across (?:the |all )?${SCOPE_NOUN}|everywhere|` +
    'bütün (?:layihə|fayllar|kod|modullar)|hər yerdə|layihə boyu',
);
/** Data or systems that make a mistake costly. "delete the unused import" is not one. */
const DATA_OBJECT = '(?:database|db|table|tables|records|rows|data|users|bucket|backups?|production)';
const RISKY = term(
  `production|prod${END}|database|payment|billing|credential|data loss|drop table|truncate|rm -rf|` +
    `(?:delete|deleting|wipe|purge) (?:all|every|the (?:${DATA_OBJECT})|${DATA_OBJECT})|` +
    'ödəniş|verilənlər bazası|bazanı|məlumatları sil|hamısını sil|canlı',
);
/**
 * Mechanical one-spot edits: renaming a symbol, dropping an unused import, changing a
 * colour or a label. Capped at trivial complexity unless something else makes them wide,
 * hard or risky.
 */
const MECHANICAL = term(
  'rename (?:the )?(?:variable|var|const|constant|field|prop|property|parameter|param|function|method|class)|' +
    '(?:delete|remove|drop) (?:the |an |all )?unused|unused imports?|' +
    '(?:change|set|make|update) (?:the )?(?:[\\p{L}-]+ ){0,3}(?:colou?r|text|label|title|placeholder|font size|icon)|' +
    'dəyişənin adını|adını dəyiş|istifadə olunmayan|rəngini',
);
/** Removing or rewriting stored data: costly to get wrong, so it needs care, not speed. */
const DESTRUCTIVE = term(
  `(?:delete|deleting|remove|removing|wipe|purge|drop|truncate|overwrite|dedup\\w*)${END}.{0,40}?(?:${DATA_OBJECT})${END}|` +
    'bazadan sil|məlumatları sil|qeydləri sil|cədvəli sil',
);
const URGENT = term('quick|fast|asap|urgent|right now|tez|təcili|sürətli');
const SERVICES = term('services|microservice|across services|servislər');
const MODULES = term(`modules?${END}|packages?(?!\\.json)${END}|modul|paket`);
/** A request that asks to explain, not to change: interrogative first, or a question mark last. */
const QUESTION_LED = term(`(?:what|how|why|which|explain|describe|nədir|necə|niyə|hansı|izah)${END}`);
/** Azerbaijani puts the verb last: "…necə işlədiyini izah et". */
const QUESTION_ENDED = /(?:izah et(?:in)?|nədir|necədir|niyə|başa sal)\s*[.?!]*\s*$/u;
const ACTION_TYPES = Object.freeze(['bug_fix', 'feature', 'refactor', 'test']);
const FILES = term('files|fayllar');
const PATH_LIKE = /(?:^|[\s`'"(])(?:[\w.-]+\/)+[\w.-]+\.\w{1,6}|(?:^|[\s`'"(])[\w-]+\.(?:js|ts|tsx|jsx|py|go|rs|java|cs|php|rb|sql|json|ya?ml|css|scss|html|md)\b/g;

function countTypes(text) {
  return Object.fromEntries(
    COMPILED.map(([type, patterns]) => {
      const hits = patterns.filter((pattern) => pattern.test(text)).length;
      return [type, type === 'question' ? hits * QUESTION_WEIGHT : hits];
    }),
  );
}

function pickType(counts, text) {
  const isQuestion = /\?\s*$/.test(text);
  const ranked = Object.entries({ ...counts, question: counts.question + (isQuestion ? 1 : 0) }).sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
  );
  const [[topType, top], [, second]] = ranked;
  if (top === 0) return { taskType: 'other', top: 0, second: 0 };

  // "Explain how the auth middleware works" asks for an explanation, not a security change:
  // a question-led request with no action verb is a question, whatever topic it names.
  const questionLed = QUESTION_LED.test(text.trimStart().split(/\s+/)[0] ?? '') || QUESTION_ENDED.test(text) || isQuestion;
  const hasAction = ACTION_TYPES.some((type) => counts[type] > 0);
  if (questionLed && !hasAction && topType !== 'question') {
    return { taskType: 'question', top: Math.max(top, 1), second: 0 };
  }
  // "Why does the login fail?" is debugging, "How do I add a button?" is a feature:
  // with an action verb present, the action outranks the question form.
  if (questionLed && hasAction && topType === 'question') {
    const [action, hits] = ACTION_TYPES.map((type) => [type, counts[type]]).sort((a, b) => b[1] - a[1])[0];
    return { taskType: action, top: hits, second: 0 };
  }
  return { taskType: topType, top, second };
}

/**
 * Lower-cases for matching. Azerbaijani/Turkish dotted capital İ does not fold to i
 * under the `i` flag, so "İŞLƏMİR" would miss every stem; fold it explicitly.
 */
function normalise(text) {
  return text.replace(/İ/g, 'i').toLowerCase();
}

function confidenceOf(top, second) {
  if (top === 0) return 0.3;
  const margin = (top - second) / top;
  return round(Math.min(0.95, 0.45 + 0.1 * Math.min(top, 3) + 0.3 * margin), 2);
}

function scopeOf(text, pathCount) {
  if (SERVICES.test(text)) return 'multi_service';
  if (MODULES.test(text) || WIDE.test(text) || pathCount >= 3) return 'multi_module';
  if (pathCount >= 2 || FILES.test(text)) return 'multi_file';
  return 'single_file';
}

/**
 * Classifies a task from its text alone, with no AI and no I/O. Deterministic.
 *
 * The prompt text is only read here; nothing derived from it is returned except
 * labels, scores and the names of the signals that fired (never the words themselves).
 *
 * @param {{ text?: string, contextTokens?: number | null }} input
 * @returns {{ classification: object, signals: string[] }}
 */
function classifyByRules(input) {
  const text = normalise(typeof input?.text === 'string' ? input.text : '');
  const counts = countTypes(text);
  const { taskType, top, second } = pickType(counts, text);
  const words = text.split(/\s+/).filter(Boolean).length;
  const pathCount = (text.match(PATH_LIKE) ?? []).length;
  const signals = [];
  const flag = (name, condition) => {
    if (condition) signals.push(name);
    return condition;
  };

  const hard = flag('hard', HARD.test(text));
  const trivial = flag('trivial', TRIVIAL.test(text) || (SIZE.test(text) && !BUILDS_SIZED.test(text)));
  const wide = flag('wide', WIDE.test(text) || pathCount >= 3);
  const risky = flag('risky', RISKY.test(text));
  const destructive = flag('destructive', DESTRUCTIVE.test(text));
  const mechanical = flag('mechanical', MECHANICAL.test(text) && !wide && !hard && !risky);
  flag('long', words > 150);

  const raw = clamp(
    BASE_COMPLEXITY[taskType] +
      (words > 150 ? 0.1 : 0) +
      (words > 400 ? 0.1 : 0) +
      (wide ? 0.15 : 0) +
      (hard ? 0.15 : 0) +
      (destructive ? 0.2 : 0) -
      (trivial ? 0.25 : 0),
    0.05,
    1,
  );
  const complexity = mechanical ? Math.min(raw, 0.2) : raw;

  const risk =
    taskType === 'security' || risky ? 'high' : ['refactor', 'architecture', 'config'].includes(taskType) || complexity >= 0.6 ? 'medium' : 'low';
  const reasoning =
    ['architecture', 'security'].includes(taskType) || complexity >= 0.7 || hard || destructive
      ? 'high'
      : complexity >= 0.4
        ? 'medium'
        : 'low';
  const codingDepth = ['question', 'docs', 'analysis'].includes(taskType)
    ? 'low'
    : complexity >= 0.65
      ? 'high'
      : complexity >= 0.35
        ? 'medium'
        : 'low';

  for (const [type, hits] of Object.entries(counts)) if (hits > 0) signals.push(`type:${type}`);

  return {
    classification: {
      taskType,
      complexity: round(complexity, 2),
      reasoning,
      codingDepth,
      risk,
      scope: scopeOf(text, pathCount),
      confidence: confidenceOf(top, second),
      latencyPriority: flag('urgent', URGENT.test(text)),
      contextTokens: Number.isInteger(input?.contextTokens) && input.contextTokens >= 0 ? input.contextTokens : null,
    },
    signals,
  };
}

module.exports = { classifyByRules, TASK_SIGNALS, normalise };
