'use strict';

const { clamp } = require('./util');

/**
 * Context size at which a model switch counts as fully expensive. A switch re-reads the
 * whole context without the cache, so the cost follows absolute tokens, not window share.
 */
const CONTEXT_PROXY_TOKENS = 200_000;

/**
 * Routing state of one agent session, or of one subagent inside it. Immutable: every
 * change returns a new state, so concurrent sessions never share anything (AC-5).
 *
 * @param {{ sessionId: string, agentId: string, subagentId?: string | null, currentModel?: string | null }} init
 */
function createSessionState(init) {
  if (!init || typeof init.sessionId !== 'string' || typeof init.agentId !== 'string') {
    throw new TypeError('createSessionState needs sessionId and agentId');
  }
  return Object.freeze({
    sessionId: init.sessionId,
    agentId: init.agentId,
    subagentId: init.subagentId ?? null,
    currentModel: init.currentModel ?? null,
    contextTokens: null,
    override: null,
    turns: 0,
    lastDecisionId: null,
  });
}

/**
 * Sets or clears a manual override. `scope: 'turn'` lasts for the next decision only,
 * `'session'` until cleared.
 * @param {object} state
 * @param {{ model: string, effort?: string | null, scope?: 'turn' | 'session' } | null} override
 */
function withOverride(state, override) {
  if (override === null) return Object.freeze({ ...state, override: null });
  if (typeof override?.model !== 'string') throw new TypeError('override.model is required');
  return Object.freeze({
    ...state,
    override: Object.freeze({ model: override.model, effort: override.effort ?? null, scope: override.scope ?? 'session' }),
  });
}

/** Records the context size the agent reported. */
function withContext(state, contextTokens) {
  const valid = Number.isInteger(contextTokens) && contextTokens >= 0;
  return Object.freeze({ ...state, contextTokens: valid ? contextTokens : null });
}

/**
 * Moves the session past a decision. The current model changes only when the adapter
 * confirmed the change (`applied`), never on a recommendation.
 */
function afterDecision(state, decision, applied) {
  return Object.freeze({
    ...state,
    currentModel: applied ? decision.selection.model : state.currentModel,
    override: state.override?.scope === 'turn' ? null : state.override,
    turns: state.turns + 1,
    lastDecisionId: decision.id,
  });
}

/** After /clear or a new conversation: the context (and its cache) is gone. */
function afterClear(state) {
  return Object.freeze({ ...state, contextTokens: 0 });
}

/** Exact context utilization (0..1), only when both numbers are known; else null. */
function contextUtilization(state, model) {
  if (state.contextTokens === null || !model?.contextWindow) return null;
  return clamp(state.contextTokens / model.contextWindow, 0, 1);
}

/** How expensive a model switch is in context terms (0..1); null when the size is unknown. */
function contextLoad(state) {
  if (state.contextTokens === null) return null;
  return clamp(state.contextTokens / CONTEXT_PROXY_TOKENS, 0, 1);
}

module.exports = {
  createSessionState,
  withOverride,
  withContext,
  afterDecision,
  afterClear,
  contextUtilization,
  contextLoad,
  CONTEXT_PROXY_TOKENS,
};
