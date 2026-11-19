'use strict';

const { EFFORT_LEVELS } = require('@smr/shared');

const RANK = Object.freeze(Object.fromEntries(EFFORT_LEVELS.map((level, index) => [level, index])));

/**
 * The effort a task asks for, from its classification.
 * xhigh only for high reasoning that is also very complex or high-risk; never `max`
 * automatically (cost), only by rule or manual override.
 */
function desiredEffort(classification) {
  const { reasoning, complexity, risk } = classification;
  if (reasoning === 'high' && (complexity >= 0.85 || risk === 'high')) return 'xhigh';
  if (reasoning === 'high') return 'high';
  if (reasoning === 'medium') return 'medium';
  return 'low';
}

/**
 * Limits `desired` to what the model supports (AC-4): the highest supported level at or
 * below it, else the lowest supported above it; null when the model takes no effort.
 *
 * @param {string | null} desired
 * @param {readonly string[]} supported
 * @returns {{ effort: string | null, clamped: boolean }}
 */
function clampEffort(desired, supported) {
  if (!desired) return { effort: null, clamped: false };
  if (supported.length === 0) return { effort: null, clamped: true };
  if (supported.includes(desired)) return { effort: desired, clamped: false };
  const sorted = [...supported].sort((a, b) => RANK[a] - RANK[b]);
  const below = sorted.filter((level) => RANK[level] < RANK[desired]);
  return { effort: below.length > 0 ? below[below.length - 1] : sorted[0], clamped: true };
}

module.exports = { desiredEffort, clampEffort };
