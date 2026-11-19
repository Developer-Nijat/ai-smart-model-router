'use strict';

const { LIVE_CHOICES } = require('./live');
const { SettingsSchema, ROUTING_MODES, PRIVACY_MODES, parseOrThrow } = require('@smr/shared');

const AI_CLASSIFIER_CHOICES = Object.freeze(['off', 'on']);
const MAX_ECHO = 40;

/**
 * Router settings from the mod's userConfig options. An unknown value falls back to its
 * safe default (shadow, local-only, classifier off) and is reported, never thrown: a typo
 * in the settings must not stop Claude Code from answering.
 *
 * @param {Record<string, unknown>} [options]
 * @returns {{ settings: object, warnings: string[] }}
 */
function settingsFromOptions(options = {}) {
  const warnings = [];
  const pick = (name, allowed, fallback) => {
    const value = options?.[name];
    if (value === undefined || value === null || value === '') return fallback;
    const text = String(value).trim().toLowerCase();
    if (allowed.includes(text)) return text;
    warnings.push(`${name}: "${String(value).slice(0, MAX_ECHO)}" is not one of ${allowed.join(', ')}; using ${fallback}`);
    return fallback;
  };

  const mode = pick('defaultMode', ROUTING_MODES, 'shadow');
  const privacy = pick('privacyMode', PRIVACY_MODES, 'local-only');
  const classifier = pick('aiClassifier', AI_CLASSIFIER_CHOICES, 'off');
  const live = pick('liveMessages', LIVE_CHOICES, 'on');
  const settings = parseOrThrow(
    SettingsSchema,
    {
      routing: { mode },
      privacy: { mode: privacy },
      classifier: { enabled: classifier === 'on', provider: 'agent-session' },
    },
    'Claude Code mod settings',
  );
  return { settings: Object.freeze(settings), warnings, live };
}

/** A copy of `settings` with another routing mode; an unknown mode keeps the current one. */
function withMode(settings, mode) {
  if (!ROUTING_MODES.includes(mode) || mode === settings.routing.mode) return settings;
  return Object.freeze({ ...settings, routing: { ...settings.routing, mode } });
}

/**
 * A copy of `settings` with the scoring tuning the daemon serves (`routing.sticky` and
 * `routing.weights`, edited in the dashboard or config.json). Mode, privacy and the
 * classifier stay with the mod's own options: they are consent, not tuning. Invalid or
 * missing tuning keeps `settings` as they are.
 *
 * @param {object} settings
 * @param {unknown} tuning `{ sticky, weights }`
 */
function withTuning(settings, tuning) {
  if (!tuning || typeof tuning !== 'object') return settings;
  const result = SettingsSchema.safeParse({
    ...settings,
    routing: { ...settings.routing, sticky: tuning.sticky, weights: tuning.weights },
  });
  return result.success ? Object.freeze(result.data) : settings;
}

module.exports = { settingsFromOptions, withMode, withTuning, AI_CLASSIFIER_CHOICES };
