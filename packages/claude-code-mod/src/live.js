'use strict';

/**
 * The live message a routing decision shows while its turn runs ("▼ opus → haiku/low ·
 * light bug fix"): one short line for the transcript and the status line, and the same
 * parts for the band above the prompt.
 *
 * Built from the decision's labels and scores only: never from the prompt text.
 */

/** How the person can turn the messages down (userConfig `liveMessages`). */
const LIVE_CHOICES = Object.freeze(['on', 'band', 'off']);

const TASK_LABELS = Object.freeze({
  bug_fix: 'bug fix',
  feature: 'feature',
  refactor: 'refactor',
  test: 'tests',
  docs: 'docs',
  analysis: 'analysis',
  architecture: 'architecture',
  security: 'security work',
  ui: 'UI change',
  config: 'config change',
  question: 'question',
  other: 'task',
});

/** `anthropic.claude-haiku` → `haiku`. */
function shortModel(id) {
  return String(id ?? '?').replace(/^[^.]+\./, '').replace(/^claude-/, '');
}

function pickOf(selection) {
  return `${shortModel(selection.model)}${selection.effort ? `/${selection.effort}` : ''}`;
}

/** "light bug fix", "heavy security work · high risk". */
function taskPhrase(classification) {
  if (!classification) return 'task';
  const weight = classification.complexity < 0.3 ? 'light' : classification.complexity < 0.6 ? 'standard' : 'heavy';
  const label = TASK_LABELS[classification.taskType] ?? 'task';
  return `${weight} ${label}${classification.risk === 'high' ? ' · high risk' : ''}`;
}

function message(tone, icon, title, detail) {
  return Object.freeze({ tone, icon, title, detail, line: `${icon} router · ${title} · ${detail}` });
}

/**
 * @param {{
 *   decision: object,
 *   applies: boolean,                       whether the turn runs on the selection
 *   previousModel?: string | null,          registry id the session was on
 *   tierOf?: (id: string) => number | null, to tell an upgrade from a downgrade
 *   subagentType?: string | null,           set for a subagent's decision
 * }} input
 * @returns {{ tone: string, icon: string, title: string, detail: string, line: string }}
 */
function liveMessage({ decision, applies, previousModel = null, tierOf = () => null, subagentType = null }) {
  const pick = pickOf(decision.selection);
  const task = taskPhrase(decision.classification);
  const previous = previousModel ? shortModel(previousModel) : null;

  if (subagentType) {
    return applies
      ? message('subagent', '↳', `subagent ${subagentType} → ${pick}`, task)
      : message('shadow', '◇', `subagent ${subagentType} would use ${pick}`, `${task} · shadow mode`);
  }
  if (!applies) {
    return message('shadow', '◇', `would use ${pick}`, `${task} · shadow mode${previous ? `, staying on ${previous}` : ''}`);
  }
  if (decision.decisionSource === 'manual') return message('manual', '✎', `override → ${pick}`, 'set with /route');
  if (decision.decisionSource === 'rule') {
    const rule = /^rule ([\w.-]+)/.exec(decision.reason)?.[1];
    return message('rule', '⚑', `rule → ${pick}`, rule ? `your rule ${rule}` : 'one of your rules');
  }
  if (decision.decisionSource === 'sticky') {
    const why = /switch cost|re-read/.test(decision.reason)
      ? 'switching would re-read the whole context'
      : /avoids model switches/.test(decision.reason)
        ? 'a rule avoids switching'
        : 'another model is only slightly better';
    return message('stay', '■', `staying on ${pick}`, `${task} · ${why}`);
  }
  const selected = decision.selection.model;
  if (!previousModel || previousModel === selected) return message('same', '●', pick, task);

  const from = tierOf(previousModel);
  const to = tierOf(selected);
  if (from !== null && to !== null && to > from) {
    const why = decision.classification?.reasoning === 'high' ? ' · needs deeper reasoning' : '';
    return message('up', '▲', `${previous} → ${pick}`, `${task}${why}`);
  }
  if (from !== null && to !== null && to < from) return message('down', '▼', `${previous} → ${pick}`, `${task} · a cheaper model is enough`);
  return message('same', '●', `${previous} → ${pick}`, task);
}

module.exports = { liveMessage, taskPhrase, shortModel, LIVE_CHOICES };
